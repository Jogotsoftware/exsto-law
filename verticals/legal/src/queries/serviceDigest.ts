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
  // B2.3 (SAVE-REDLINES-1) — the structured document.redlined event for this
  // version, when the save that produced it emitted one (the tracked-changes
  // editor; optional group, verticals/legal/src/handlers/draft.ts). Optional:
  // absent for edits from before B2.3, or from any path that doesn't send the
  // redline group. buildServiceDigestEvidence prefers this over parsing the
  // note-string "AI revision: " prefix.
  redline?: { source: 'human' | 'ai_accepted' | 'mixed'; instructionText: string | null } | null
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
  // WP B4 (context spine): when a documentEntityId is given, scope to that ONE
  // document's own history — its version notes and revision asks — instead of
  // the cross-matter service digest (draft_revision uses the same two readers,
  // narrowed, rather than a forked query). The serviceKey argument is then
  // unused; the document's own id is authoritative regardless of the matter's
  // current service_key.
  opts: { documentEntityId?: string } = {},
): Promise<ServiceDigestSignals> {
  return withActionContext(ctx, async (client) => {
    const { documentEntityId } = opts
    const serviceKeyMatch = `(SELECT a.value #>> '{}' FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = m.id AND akd.kind_name = 'service_key'
        ORDER BY a.valid_from DESC LIMIT 1) = $2`
    // $2 is either the serviceKey (digest) or the documentEntityId (revision).
    const notesScope = documentEntityId ? 'dv.document_entity_id = $2' : serviceKeyMatch
    const requestsScope = documentEntityId ? 'e_doc.id = $2' : serviceKeyMatch
    const scopeValue = documentEntityId ?? serviceKey

    const notesRes = await client.query<{
      matter_id: string
      matter_number: string
      document_kind: string
      document_version_id: string
      version_number: number
      note: string | null
      recorded_at: string
      redline_source: string | null
      redline_instruction: string | null
    }>(
      `SELECT m.id AS matter_id, m.name AS matter_number,
              coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
              dv.id AS document_version_id, dv.version_number,
              dv.metadata->>'note' AS note,
              to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at,
              rl.payload->>'source' AS redline_source,
              rl.payload->>'instruction_text' AS redline_instruction
         FROM document_version dv
         JOIN entity e_doc ON e_doc.id = dv.document_entity_id
         JOIN relationship r ON r.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
              AND rkd.kind_name = 'draft_of'
         JOIN entity m ON m.id = r.target_entity_id
         LEFT JOIN LATERAL (
           -- B2.3: the document.redlined event this version's save emitted, if
           -- any (structured-first source for buildServiceDigestEvidence).
           SELECT ev.payload
             FROM event ev
             JOIN event_kind_definition ekd ON ekd.id = ev.event_kind_id
            WHERE ev.tenant_id = dv.tenant_id
              AND ekd.kind_name = 'document.redlined'
              AND ev.payload->>'to_version_id' = dv.id::text
            ORDER BY ev.occurred_at DESC
            LIMIT 1
         ) rl ON true
        WHERE dv.tenant_id = $1
          AND dv.metadata->>'note' IS NOT NULL
          AND ${notesScope}
        ORDER BY dv.recorded_at DESC`,
      [ctx.tenantId, scopeValue],
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
          AND ${requestsScope}
        ORDER BY o.recorded_at DESC`,
      [ctx.tenantId, scopeValue],
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
        redline:
          r.redline_source === 'human' ||
          r.redline_source === 'ai_accepted' ||
          r.redline_source === 'mixed'
            ? { source: r.redline_source, instructionText: r.redline_instruction ?? null }
            : null,
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
