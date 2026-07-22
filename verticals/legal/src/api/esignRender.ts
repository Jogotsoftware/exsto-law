// ESIGN-UNIFY-1 ES-2 (§5.2) — resolve a document_version for the placement
// canvas. The render route (app/api/attorney/esign/render) calls this, then:
//   • file version   → the app streams the stored bytes (lib/documentStorage
//     owns bytes — CI vertical-storage-guard keeps Storage out of the vertical);
//     no markers (an uploaded PDF has no {{type:key}} anchors).
//   • markdown draft → the route renders the SAME PDF the export pipeline
//     produces (render/draftPdf.ts) and derives the marker map (§5.2) from the
//     SAME body — placement PDF ≡ download PDF, one visual truth.
// Tenant-scoped read (RLS via withActionContext); a foreign id resolves to null.

import { withActionContext, type ActionContext } from '@exsto/substrate'
import { signingCtx } from './esign.js'
import { deriveMarkerMap, type MarkerMapEntry } from '../esign/markerMap.js'
import type { PlacementContactFacts } from '../esign/placementData.js'
import { parseEnvelopePlacements, placementsForDoc, verifySigningToken } from '../esign/index.js'
import type { FieldPlacement } from '../esign/placements.js'
import { isSignatureImageDataUrl } from '../esign/fields.js'
import type { StampField } from '../esign/stampPdf.js'
import type { FileCertInput } from '../esign/fileCertificate.js'
import { renderDraftPdf, draftWatermarkText } from '../render/draftPdf.js'

export type PlacementSource =
  | {
      kind: 'file'
      documentEntityId: string
      objectKey: string
      contentType: string
      filename: string
    }
  | {
      kind: 'markdown'
      documentEntityId: string
      body: string
      title: string | null
      status: string | null
    }

export async function loadVersionForPlacement(
  ctx: ActionContext,
  documentVersionId: string,
): Promise<PlacementSource | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      document_entity_id: string
      body: string | null
      status: string | null
      object_key: string | null
      content_type: string | null
      filename: string | null
      doc_name: string | null
    }>(
      `SELECT dv.document_entity_id,
              cb.body,
              dv.status,
              dv.metadata->>'object_key' AS object_key,
              COALESCE(dv.metadata->>'content_type', cb.content_type) AS content_type,
              dv.metadata->>'original_filename' AS filename,
              e.name AS doc_name
         FROM document_version dv
         JOIN content_blob cb ON cb.id = dv.content_blob_id
         LEFT JOIN entity e ON e.id = dv.document_entity_id AND e.tenant_id = dv.tenant_id
        WHERE dv.tenant_id = $1 AND dv.id = $2
        LIMIT 1`,
      [ctx.tenantId, documentVersionId],
    )
    const row = res.rows[0]
    if (!row) return null
    if (row.object_key) {
      return {
        kind: 'file',
        documentEntityId: row.document_entity_id,
        objectKey: row.object_key,
        contentType: row.content_type ?? 'application/pdf',
        filename: row.filename ?? 'document.pdf',
      }
    }
    return {
      kind: 'markdown',
      documentEntityId: row.document_entity_id,
      body: row.body ?? '',
      title: row.doc_name,
      status: row.status,
    }
  })
}

export interface RenderedPlacementDoc {
  pdf: Buffer
  markers: MarkerMapEntry[]
}

/** Render a markdown draft to the exact export PDF + its marker map. */
export async function renderMarkdownForPlacement(
  source: Extract<PlacementSource, { kind: 'markdown' }>,
): Promise<RenderedPlacementDoc> {
  const pdf = await renderDraftPdf(source.body, {
    title: source.title ?? undefined,
    watermark: draftWatermarkText(source.status),
  })
  return { pdf, markers: deriveMarkerMap(source.body) }
}

// ── §5.3 send-time facts ─────────────────────────────────────────────────────

/** The bound contact's own attributes for placement auto-fill (§5.3): email/
 *  phone/address/company_name, read tenant-scoped. Firm identity NEVER rides
 *  here — these are contact-entity attributes only (the resolver's allow-list
 *  is the second fence). Null when no contact is bound. */
export async function loadPlacementContactFacts(
  ctx: ActionContext,
  contactEntityId: string,
): Promise<PlacementContactFacts | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ kind_name: string; value: string | null }>(
      `SELECT akd.kind_name, a.value #>> '{}' AS value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = $2
          AND akd.kind_name IN ('email', 'phone', 'address', 'company_name')
        ORDER BY a.valid_from ASC`,
      [ctx.tenantId, contactEntityId],
    )
    if (res.rows.length === 0) return null
    // Later rows win (valid_from ASC → the latest write is applied last).
    const facts: Record<string, string | null> = {}
    for (const row of res.rows) facts[row.kind_name] = row.value
    return {
      email: facts.email ?? null,
      phone: facts.phone ?? null,
      address: facts.address ?? null,
      company: facts.company_name ?? null,
    }
  })
}

// ── §5.4 executed-copy stamping plan ─────────────────────────────────────────

/** Where the stamped executed PDF lives in Storage, derived from the original's
 *  object key — one deterministic rule shared by the stamping route and every
 *  streaming route (no substrate write needed to find it). */
export function executedPdfObjectKey(objectKey: string): string {
  return `${objectKey}.executed.pdf`
}

export interface ExecutedStampPlan {
  envelopeId: string
  /** esign-executed-copy-complete — this document's position in the envelope's
   *  send order (same 0-based index the file byte routes use as `?doc=N`).
   *  Lets a caller that stamps multiple plans (ES-MULTIDOC-1) match each
   *  stamped result back to its document (e.g. to attach it to the
   *  completion email — sendEnvelopeCompletionCopies). */
  docIndex: number
  objectKey: string
  executedObjectKey: string
  filename: string
  fields: StampField[]
  certificate: FileCertInput
}

interface PlanSignerRow {
  signer_key: string | null
  name: string | null
  email: string | null
  title: string | null
  signed_at: string | null
  consent: string | null
  signature_data: string | null
  field_values_json: string | null
}

interface PlanSigner extends PlanSignerRow {
  field_values: Record<string, string> | null
}

/** Resolve one document's placement subset to StampFields (§5.4). Pure over the
 *  loaded signers — shared by every document in a multi-document envelope. */
function buildStampFields(
  placements: FieldPlacement[],
  byKey: Map<string, PlanSigner>,
): StampField[] {
  return placements.map((p) => {
    const signer = byKey.get(p.signerKey)
    const filled = signer?.field_values?.[p.id]
    switch (p.type) {
      case 'sign':
      case 'initial': {
        // Auth micro-stamp facts: who signed + when (drawn as a tiny in-box
        // caption by stampPdf; the certificate page still carries the full audit).
        const auth = { signerName: signer?.name ?? null, signedAt: signer?.signed_at ?? null }
        const sig = signer?.signature_data ?? null
        if (sig && isSignatureImageDataUrl(sig)) {
          return { type: p.type, rect: p.rect, signatureDataUrl: sig, ...auth }
        }
        // Typed adoption: the stamper draws the name in the oblique sig font.
        const name = signer?.name ?? sig ?? ''
        return {
          type: p.type,
          rect: p.rect,
          value: p.type === 'initial' ? initialsOf(name) : name,
          ...auth,
        }
      }
      case 'name':
        return { type: p.type, rect: p.rect, value: signer?.name ?? '' }
      case 'date':
        // Auto-date (15.7): the ACTUAL signing moment, recorded server-side —
        // the signer never typed it.
        return { type: p.type, rect: p.rect, value: (signer?.signed_at ?? '').slice(0, 10) }
      case 'title':
        return { type: p.type, rect: p.rect, value: filled ?? p.value ?? signer?.title ?? '' }
      case 'email':
        return { type: p.type, rect: p.rect, value: p.value ?? filled ?? signer?.email ?? '' }
      case 'check':
        return { type: p.type, rect: p.rect, checked: (filled ?? '').toLowerCase() === 'true' }
      default:
        // company/phone/address/text — send-time resolved value, else what the
        // signer typed. Never invented.
        return { type: p.type, rect: p.rect, value: p.value ?? filled ?? '' }
    }
  })
}

interface StampDocRow {
  object_key: string | null
  content_type: string | null
  filename: string | null
  sha256_hex: string | null
  size_bytes: string | null
}

/**
 * The stamping plans for a COMPLETED envelope: ONE plan per PDF document that
 * carries placements (ES-MULTIDOC-1). Each plan resolves that document's
 * placement subset (grouped by docIndex) to its final values (adopted signature
 * image / typed name / signing date / send-time data value / signer-filled
 * value) plus the §5.4 certificate for that document. Empty array when there is
 * nothing to stamp (not completed, no placements, no PDF document) — the caller
 * (a byte-having Next route; the vertical never touches Storage) then simply
 * skips stamping and the certificate-markdown executed versions stand alone,
 * exactly the pre-ES-2 behavior. A single-document envelope yields exactly one
 * plan — byte-identical to the pre-multidoc single return, just wrapped.
 */
export async function loadExecutedStampPlan(
  ctx: ActionContext,
  envelopeId: string,
): Promise<ExecutedStampPlan[]> {
  return withActionContext(ctx, async (client) => {
    const status = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'envelope_status'
        ORDER BY a.valid_from DESC LIMIT 1`,
      [ctx.tenantId, envelopeId],
    )
    if (status.rows[0]?.value !== 'completed') return []

    const placementsRes = await client.query<{ value: string }>(
      `SELECT a.value::text AS value FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'envelope_placements'
        ORDER BY a.valid_from DESC LIMIT 1`,
      [ctx.tenantId, envelopeId],
    )
    let placements: ReturnType<typeof parseEnvelopePlacements> = []
    try {
      placements = parseEnvelopePlacements(JSON.parse(placementsRes.rows[0]?.value ?? 'null'))
    } catch {
      placements = []
    }
    if (placements.length === 0) return []

    // ES-MULTIDOC-1 — every document in send order (the `order` on each
    // envelope_of relationship; a legacy single-doc envelope's absent order
    // reads as 0). A LATERAL join picks each document's latest NON-executed
    // (original) version. The row position IS the docIndex the placements
    // reference (the handler wrote order = position; the composer tags
    // placements with the same position).
    const docsRes = await client.query<StampDocRow>(
      `SELECT dv.metadata->>'object_key' AS object_key,
              COALESCE(dv.metadata->>'content_type', cb.content_type) AS content_type,
              dv.metadata->>'original_filename' AS filename,
              encode(cb.sha256, 'hex') AS sha256_hex,
              dv.metadata->>'size_bytes' AS size_bytes
         FROM relationship r
         JOIN relationship_kind_definition rkd
           ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'envelope_of'
         JOIN LATERAL (
           SELECT dv2.* FROM document_version dv2
            WHERE dv2.document_entity_id = r.target_entity_id AND dv2.tenant_id = r.tenant_id
              AND (dv2.metadata->>'executed') IS DISTINCT FROM 'true'
            ORDER BY dv2.version_number DESC LIMIT 1
         ) dv ON true
         JOIN content_blob cb ON cb.id = dv.content_blob_id
        WHERE r.tenant_id = $1 AND r.source_entity_id = $2
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY COALESCE((r.properties->>'order')::int, 0), r.recorded_at`,
      [ctx.tenantId, envelopeId],
    )
    if (docsRes.rows.length === 0) return []

    const attr = (k: string) =>
      `(SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
          ON akd.id = a.attribute_kind_id AND akd.kind_name = '${k}'
          WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
          ORDER BY a.valid_from DESC LIMIT 1)`
    const signersRes = await client.query<PlanSignerRow>(
      `SELECT ${attr('signer_key')} AS signer_key, ${attr('signer_name')} AS name,
              ${attr('signer_email')} AS email, ${attr('signer_title')} AS title,
              ${attr('signed_at')} AS signed_at, ${attr('signer_consent')} AS consent,
              ${attr('signature_data')} AS signature_data,
              (SELECT a.value::text FROM attribute a JOIN attribute_kind_definition akd
                  ON akd.id = a.attribute_kind_id AND akd.kind_name = 'field_values'
                  WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
                  ORDER BY a.valid_from DESC LIMIT 1) AS field_values_json
         FROM relationship r
         JOIN relationship_kind_definition rkd
           ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
        WHERE r.tenant_id = $1 AND r.target_entity_id = $2
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY ${attr('signer_order')} NULLS LAST, r.recorded_at`,
      [ctx.tenantId, envelopeId],
    )
    const signers: PlanSigner[] = signersRes.rows.map((row) => ({
      ...row,
      field_values: safeParseRecord(row.field_values_json),
    }))
    const byKey = new Map(signers.filter((s) => s.signer_key).map((s) => [s.signer_key!, s]))
    const certSigners = signers.map((s) => ({
      name: s.name,
      email: s.email,
      title: s.title,
      signed_at: s.signed_at,
      consent: s.consent,
    }))

    const plans: ExecutedStampPlan[] = []
    for (let d = 0; d < docsRes.rows.length; d++) {
      const docRow = docsRes.rows[d]!
      // Only PDF documents can be stamped; a non-PDF (or bodyless) document keeps
      // its markdown-certificate executed version and is skipped here.
      if (!docRow.object_key || docRow.content_type !== 'application/pdf') continue
      const docPlacements = placementsForDoc(placements, d)
      // A document with no placements has nothing to stamp — its original bytes
      // ARE its executed copy (the pre-ES-2 single-doc rule, applied per doc).
      if (docPlacements.length === 0) continue
      plans.push({
        envelopeId,
        docIndex: d,
        objectKey: docRow.object_key,
        executedObjectKey: executedPdfObjectKey(docRow.object_key),
        filename: docRow.filename ?? 'document.pdf',
        fields: buildStampFields(docPlacements, byKey),
        certificate: {
          envelopeId,
          filename: docRow.filename,
          contentType: docRow.content_type,
          sizeBytes: docRow.size_bytes ? Number(docRow.size_bytes) : null,
          sha256Hex: docRow.sha256_hex,
          signers: certSigners,
        },
      })
    }
    return plans
  })
}

/** Token door for the stamping step in /api/sign/submit: the final signer's
 *  submit completes the envelope, then the route (which owns Storage bytes)
 *  stamps the executed copy of every placement-carrying document. Throws on a
 *  bad token, empty array when nothing to stamp. */
export async function loadExecutedStampPlanByToken(token: string): Promise<ExecutedStampPlan[]> {
  const tok = verifySigningToken(token)
  return loadExecutedStampPlan(signingCtx(tok.tenantId), tok.envelopeId)
}

function safeParseRecord(raw: string | null): Record<string, string> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
  } catch {
    // fall through
  }
  return null
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
