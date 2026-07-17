// Brief engine WP1 — the Service Digest signal (design doc §2a). "How attorneys
// change this service's drafts" is already captured append-only and needs no new
// capture: reviseDraftText's ACCEPTED AI revision instruction is persisted verbatim
// as the resulting document_version's metadata.note (prefixed "AI revision: " —
// see apps/legal-demo's acceptRevision()); a plain manual tweak lands the same way
// via document.edit with the attorney's own note; and draft.request_revision
// records an ASK as a draft_revision_requested outcome with { document_version_id,
// notes }. This is the first read that assembles those signals PER SERVICE (across
// every matter currently on that service_key) rather than per matter — the whole
// point of the digest is cross-matter drafting preference, not one matter's history.
import { withActionContext, type ActionContext } from '@exsto/substrate'

export interface ServiceDraftNote {
  matterEntityId: string
  matterNumber: string
  documentKind: string
  documentVersionId: string
  versionNumber: number
  // The raw metadata.note text (still carries the "AI revision: " prefix when
  // present — callers that want to distinguish accepted-AI-revision instructions
  // from plain manual edit notes split on that prefix; see briefEvidence.ts).
  note: string
  recordedAt: string
}

export interface ServiceRevisionRequest {
  matterEntityId: string
  matterNumber: string
  documentKind: string
  documentVersionId: string | null
  notes: string
  recordedAt: string
}

export interface ServiceDigestSignals {
  draftNotes: ServiceDraftNote[]
  revisionRequests: ServiceRevisionRequest[]
}

// Every document_version note (document.edit — accepted AI revision or a manual
// edit) and every draft.request_revision ask, across all matters CURRENTLY on
// serviceKey (latest service_key attribute), newest first. Read-only, tenant-scoped.
export async function listServiceDigestSignals(
  ctx: ActionContext,
  serviceKey: string,
): Promise<ServiceDigestSignals> {
  return withActionContext(ctx, async (client) => {
    const serviceKeyMatch = `(SELECT a.value #>> '{}' FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = m.id AND akd.kind_name = 'service_key'
        ORDER BY a.valid_from DESC LIMIT 1) = $2`

    const notesRes = await client.query<{
      matter_id: string
      matter_number: string
      document_kind: string
      document_version_id: string
      version_number: number
      note: string | null
      recorded_at: string
    }>(
      `SELECT m.id AS matter_id, m.name AS matter_number,
              coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
              dv.id AS document_version_id, dv.version_number,
              dv.metadata->>'note' AS note,
              to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at
         FROM document_version dv
         JOIN entity e_doc ON e_doc.id = dv.document_entity_id
         JOIN relationship r ON r.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
              AND rkd.kind_name = 'draft_of'
         JOIN entity m ON m.id = r.target_entity_id
        WHERE dv.tenant_id = $1
          AND dv.metadata->>'note' IS NOT NULL
          AND ${serviceKeyMatch}
        ORDER BY dv.recorded_at DESC`,
      [ctx.tenantId, serviceKey],
    )

    const requestsRes = await client.query<{
      matter_id: string
      matter_number: string
      document_kind: string
      document_version_id: string | null
      notes: string | null
      recorded_at: string
    }>(
      `SELECT m.id AS matter_id, m.name AS matter_number,
              coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
              (o.outcome_data->>'document_version_id') AS document_version_id,
              (o.outcome_data->>'notes') AS notes,
              to_char(o.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at
         FROM outcome o
         JOIN outcome_kind_definition okd ON okd.id = o.outcome_kind_id
              AND okd.kind_name = 'draft_revision_requested'
         JOIN entity e_doc ON e_doc.id = o.subject_entity_id
         JOIN relationship r ON r.source_entity_id = e_doc.id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
              AND rkd.kind_name = 'draft_of'
         JOIN entity m ON m.id = r.target_entity_id
        WHERE o.tenant_id = $1
          AND o.outcome_data->>'notes' IS NOT NULL
          AND ${serviceKeyMatch}
        ORDER BY o.recorded_at DESC`,
      [ctx.tenantId, serviceKey],
    )

    return {
      draftNotes: notesRes.rows.map((r) => ({
        matterEntityId: r.matter_id,
        matterNumber: r.matter_number,
        documentKind: r.document_kind,
        documentVersionId: r.document_version_id,
        versionNumber: r.version_number,
        note: r.note ?? '',
        recordedAt: r.recorded_at,
      })),
      revisionRequests: requestsRes.rows.map((r) => ({
        matterEntityId: r.matter_id,
        matterNumber: r.matter_number,
        documentKind: r.document_kind,
        documentVersionId: r.document_version_id,
        notes: r.notes ?? '',
        recordedAt: r.recorded_at,
      })),
    }
  })
}
