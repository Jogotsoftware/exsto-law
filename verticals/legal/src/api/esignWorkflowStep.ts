// ESIGN-UNIFY-1 ES-4 (design §7) — the workflow e-sign step's open-time context.
//
// When the matter workflow runner opens an `esign` step, this read assembles
// everything the confirm-and-send surface needs, WITHOUT persisting anything
// (§2 principle 4 — no draft envelopes): the latest APPROVED version of the
// step's document kind, the recipients resolved from the service's template
// e-sign config (esignPrefill §6.4), the count of pre-placed signature markers
// in the approved body, and the latest envelope already sent from this document
// (so a re-opened step honestly shows "sent — awaiting signatures" instead of
// offering a second send). Pure READ layer — the composer submits the ONE
// esign.send via the existing legal.esign.send_for_signature when the attorney
// confirms.
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { parseFields } from '../esign/fields.js'
import { resolveTemplateRecipients, type ResolvedEsignRecipient } from './esignPrefill.js'
import { getDocumentTemplateEsignConfig } from './services.js'
import type { TemplateEsignConfig } from '../queries/templates.js'

export interface EsignStepDocument {
  documentEntityId: string
  documentVersionId: string
  versionNumber: number
  /** Attorney-facing title — the humanized document kind. */
  title: string
}

export interface EsignStepEnvelope {
  envelopeId: string
  /** envelope_status: pending_dispatch | sent | completed | declined | voided. */
  status: string
}

export interface EsignWorkflowStepContext {
  documentKind: string
  /** The service's e-sign declaration for this kind (ES-3). */
  signable: boolean
  /** Latest APPROVED version of this kind on the matter — what gets sent. */
  document: EsignStepDocument | null
  /** {{type:key}} markers in the approved body — the pre-placed field count. */
  markerCount: number
  /** Template roles resolved against the matter (editable in the composer). */
  recipients: ResolvedEsignRecipient[]
  /** Subject default: "<Document title> — <matter number>" (no legacy prefix). */
  subject: string | null
  /** Latest envelope already sent from this document, if any. */
  envelope: EsignStepEnvelope | null
}

function humanizeDocKind(docKind: string): string {
  const s = docKind.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : docKind
}

interface ApprovedVersionRow {
  version_id: string
  document_entity_id: string
  version_number: number
  body: string
}

// The latest approved version of the matter's document of this kind, via the
// draft_of relationship (the same join discipline queries/drafts.ts uses; the
// document_kind default mirrors drafts.ts — legacy documents predate the
// metadata key and are all operating agreements).
async function latestApprovedVersion(
  ctx: ActionContext,
  matterEntityId: string,
  documentKind: string,
): Promise<ApprovedVersionRow | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<ApprovedVersionRow>(
      `SELECT dv.id AS version_id,
              dv.document_entity_id,
              dv.version_number,
              cb.body
         FROM document_version dv
         JOIN content_blob cb ON cb.id = dv.content_blob_id
         JOIN entity e_doc ON e_doc.id = dv.document_entity_id
         JOIN relationship r ON r.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
        WHERE dv.tenant_id = $1
          AND r.tenant_id = $1
          AND r.target_entity_id = $2
          AND rkd.kind_name = 'draft_of'
          AND (r.valid_to IS NULL OR r.valid_to > now())
          AND dv.status = 'approved'
          AND coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') = $3
        ORDER BY dv.version_number DESC, dv.recorded_at DESC
        LIMIT 1`,
      [ctx.tenantId, matterEntityId, documentKind],
    )
    return res.rows[0] ?? null
  })
}

// The latest envelope sent FROM this document (envelope_of: envelope → document)
// with its current envelope_status — the step's "already sent?" signal.
async function latestEnvelopeForDocument(
  ctx: ActionContext,
  documentEntityId: string,
): Promise<EsignStepEnvelope | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ envelope_id: string; status: string | null }>(
      `SELECT r.source_entity_id AS envelope_id,
              (SELECT a.value #>> '{}'
                 FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                WHERE a.tenant_id = $1
                  AND a.entity_id = r.source_entity_id
                  AND akd.kind_name = 'envelope_status'
                ORDER BY a.valid_from DESC
                LIMIT 1) AS status
         FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
        WHERE r.tenant_id = $1
          AND r.target_entity_id = $2
          AND rkd.kind_name = 'envelope_of'
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY r.recorded_at DESC
        LIMIT 1`,
      [ctx.tenantId, documentEntityId],
    )
    const row = res.rows[0]
    if (!row) return null
    return { envelopeId: row.envelope_id, status: row.status ?? 'pending_dispatch' }
  })
}

async function matterFacts(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<{ matterNumber: string | null; serviceKey: string | null }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ name: string | null; service_key: string | null }>(
      `SELECT e.name,
              (SELECT a.value #>> '{}'
                 FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'service_key'
                ORDER BY a.valid_from DESC
                LIMIT 1) AS service_key
         FROM entity e
        WHERE e.tenant_id = $1 AND e.id = $2`,
      [ctx.tenantId, matterEntityId],
    )
    const row = res.rows[0]
    return { matterNumber: row?.name ?? null, serviceKey: row?.service_key ?? null }
  })
}

export interface EsignWorkflowStepInput {
  matterEntityId: string
  documentKind: string
}

export async function getEsignWorkflowStepContext(
  ctx: ActionContext,
  input: EsignWorkflowStepInput,
): Promise<EsignWorkflowStepContext> {
  const documentKind = input.documentKind.trim()
  if (!input.matterEntityId || !documentKind) {
    throw new Error('matterEntityId and documentKind are required.')
  }

  const { matterNumber, serviceKey } = await matterFacts(ctx, input.matterEntityId)

  let config: TemplateEsignConfig | null = null
  if (serviceKey) {
    config = await getDocumentTemplateEsignConfig(ctx, serviceKey, documentKind)
  }
  const signable = config?.signable === true

  const recipients: ResolvedEsignRecipient[] =
    signable && config
      ? await resolveTemplateRecipients(ctx, { matterEntityId: input.matterEntityId, config })
      : []

  const version = await latestApprovedVersion(ctx, input.matterEntityId, documentKind)
  const title = humanizeDocKind(documentKind)
  const document: EsignStepDocument | null = version
    ? {
        documentEntityId: version.document_entity_id,
        documentVersionId: version.version_id,
        versionNumber: version.version_number,
        title,
      }
    : null
  // Pre-placed fields = the SIG-BLOCK-1 markers already in the approved body
  // (the placement canvas derives boxes from these; the whole-line signer flow
  // fills them directly).
  const markerCount = version ? parseFields(version.body).length : 0

  const envelope = document ? await latestEnvelopeForDocument(ctx, document.documentEntityId) : null

  return {
    documentKind,
    signable,
    document,
    markerCount,
    recipients,
    // Subject default = document title (+ matter number for the inbox) — never
    // the legacy "Signature requested:" prefix (§3 step 4).
    subject: document ? (matterNumber ? `${title} — ${matterNumber}` : title) : null,
    envelope,
  }
}
