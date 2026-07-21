// E-sign ANY document (0170): standalone uploaded-PDF envelopes, DocuSign-style.
// The envelope/request/esign.send kinds were always document-agnostic — this
// module is the send path for documents whose content is a STORED FILE (bytes in
// Supabase Storage, object key in content_blob.body) rather than a markdown
// draft. Differences from the draft path (api/esign.ts):
//
//   • No field tags: a file has no inline {{type:key}} anchors, so every file
//     envelope is a whole-document sign + appended signature certificate (the
//     model's existing no-tags fallback).
//   • Every signer routes via the LINK channel. The portal signing surfaces
//     resolve a client's documents through draft_of → matter, which uploads are
//     not part of — an emailed secure /sign/<token> link works for everyone.
//   • Recipients become contacts: esign.send (save_signers_as_contacts) creates
//     a client_contact for any signer email not already in contacts.
//
// This module never touches Storage (CI vertical-storage-guard): it reads/writes
// the SUBSTRATE side only; the Next routes own bytes via lib/documentStorage.
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { assertCanSendOnMatter } from './matterAccess.js'
import { notifyDelivered, signingCtx } from './esign.js'
import { buildAndSubmitEnvelope, type RecipientRole } from './esignSend.js'
import { loadPlacementContactFacts } from './esignRender.js'
import { verifySigningToken } from '../esign/index.js'
import type { FieldPlacement } from '../esign/placements.js'
import { resolvePlacementData } from '../esign/placementData.js'

export interface FileSigner {
  email: string
  name?: string
  title?: string
  order?: number
  /** ES-2 (§5.1): the signer key the envelope's placements reference
   *  (FieldPlacement.signerKey). The composer assigns one per recipient;
   *  pre-composer callers omit it. */
  key?: string
  /** ESIGN-UNIFY-1 (ES-1, §9.2): needs_to_sign (default) | needs_to_view |
   *  receives_copy. Pre-ES-1 callers omit it — unchanged behavior. */
  role?: RecipientRole
}

export interface SendFileForSignatureInput {
  /** The uploaded document_version to send (metadata.object_key present). When
   *  `documents` is provided this is ignored in favor of documents[0]; kept for
   *  every pre-multidoc caller (single document). */
  documentVersionId: string
  /** ES-MULTIDOC-1: the FULL ordered set of uploaded PDFs for a multi-document
   *  envelope. Each is an uploaded document_version (object_key present). When
   *  present and non-empty it defines the envelope's documents in order; absent
   *  ⇒ the single `documentVersionId` is the set (unchanged behavior). */
  documents?: Array<{ documentVersionId: string }>
  signers: FileSigner[]
  subject?: string
  /** ESIGN-UNIFY-1 (ES-1, §5.1): the composer's coordinate placement plan across
   *  ALL documents in the envelope (all source:'placed' — an uploaded file has no
   *  markers). Each placement's docIndex (ES-MULTIDOC-1; absent ⇒ 0) binds it to
   *  a document in the ordered set above. */
  placements?: FieldPlacement[]
  /** §9.4: the sender's personal note, shown in the branded signing email. */
  message?: string
}

export interface SendFileForSignatureResult {
  envelopeId: string
  documentVersionId: string
  signerCount: number
  signers: Array<{
    email: string
    channel: 'portal' | 'link'
    order: number
    delivered: boolean
    url?: string
  }>
  /** Recipients who weren't in contacts yet, saved as new client_contacts. */
  savedContacts: Array<{ email: string; contactEntityId: string }>
}

interface UploadedDocRow {
  document_entity_id: string
  object_key: string | null
  content_type: string | null
  filename: string | null
  matter_entity_id: string | null
  contact_entity_id: string | null
}

async function loadUploadedVersion(
  ctx: ActionContext,
  documentVersionId: string,
): Promise<UploadedDocRow | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<UploadedDocRow>(
      `SELECT dv.document_entity_id,
              dv.metadata->>'object_key' AS object_key,
              COALESCE(dv.metadata->>'content_type', cb.content_type) AS content_type,
              dv.metadata->>'original_filename' AS filename,
              m.target_entity_id AS matter_entity_id,
              c.target_entity_id AS contact_entity_id
         FROM document_version dv
         JOIN content_blob cb ON cb.id = dv.content_blob_id
         LEFT JOIN relationship m ON m.source_entity_id = dv.document_entity_id
           AND m.tenant_id = dv.tenant_id
           AND (m.valid_to IS NULL OR m.valid_to > now())
           AND m.relationship_kind_id =
               (SELECT id FROM relationship_kind_definition
                 WHERE kind_name = 'document_of' AND tenant_id = $1 LIMIT 1)
         LEFT JOIN relationship c ON c.source_entity_id = dv.document_entity_id
           AND c.tenant_id = dv.tenant_id
           AND (c.valid_to IS NULL OR c.valid_to > now())
           AND c.relationship_kind_id =
               (SELECT id FROM relationship_kind_definition
                 WHERE kind_name = 'document_of_contact' AND tenant_id = $1 LIMIT 1)
        WHERE dv.tenant_id = $1 AND dv.id = $2
        LIMIT 1`,
      [ctx.tenantId, documentVersionId],
    )
    return res.rows[0] ?? null
  })
}

export async function sendFileForSignature(
  ctx: ActionContext,
  input: SendFileForSignatureInput,
): Promise<SendFileForSignatureResult> {
  // ES-MULTIDOC-1 — the ordered document set. Absent/empty `documents` ⇒ the
  // single `documentVersionId` (the pre-multidoc shape). documents[0] is the
  // primary the envelope keys on (subject default, matter/contact binding).
  const versionIds = (
    input.documents && input.documents.length > 0
      ? input.documents.map((d) => d.documentVersionId)
      : [input.documentVersionId]
  )
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id))
  if (versionIds.length === 0) throw new Error('No document to send for signature.')

  const docs: UploadedDocRow[] = []
  for (const versionId of versionIds) {
    const row = await loadUploadedVersion(ctx, versionId)
    if (!row?.object_key) {
      throw new Error(`Uploaded document version not found: ${versionId}`)
    }
    if (row.content_type !== 'application/pdf') {
      throw new Error('Only PDF documents can be sent for signature this way.')
    }
    docs.push(row)
  }
  const doc = docs[0]!
  // Send authz mirrors the draft path: a matter-attached upload dispatches under
  // the matter's ownership gate; a standalone upload has no ownership to gate.
  // Every matter-attached document in the set is gated (they usually share one
  // matter, but a mixed set must clear each).
  const gatedMatters = new Set<string>()
  for (const d of docs) {
    if (d.matter_entity_id && !gatedMatters.has(d.matter_entity_id)) {
      await assertCanSendOnMatter(ctx, d.matter_entity_id)
      gatedMatters.add(d.matter_entity_id)
    }
  }

  const signers = (input.signers ?? [])
    .filter((s) => s.email?.trim())
    .map((s, i) => ({
      email: s.email.trim(),
      name: s.name?.trim() || null,
      key: s.key?.trim() || null,
      title: s.title?.trim() || null,
      order: s.order ?? i + 1,
      channel: 'link' as const,
      role: s.role ?? null,
    }))
  if (signers.length === 0) throw new Error('Add at least one signer with an email address.')

  const subject =
    input.subject?.trim() ||
    (docs.length > 1
      ? `Signature requested: ${docs.length} documents`
      : `Signature requested: ${doc.filename ?? 'uploaded document'}`)

  // ES-2 (§5.3) — resolve data-bound placements at SEND time: the signer's own
  // recipient row first, then the bound contact's attributes. Resolved values
  // are baked into each placement (`value`); unresolvable stays signer-fillable.
  // FIRM_DEFAULTS can never reach this path — the facts come from the recipient
  // rows and the contact entity only (loadPlacementContactFacts), and the
  // resolver's matter allow-list drops any firm-identity key regardless.
  let placements = input.placements
  if (placements?.length) {
    const contactFacts = doc.contact_entity_id
      ? await loadPlacementContactFacts(ctx, doc.contact_entity_id).catch(() => null)
      : null
    const resolved = resolvePlacementData(placements, {
      recipients: signers.map((s) => ({
        signerKey: s.key || s.email,
        name: s.name,
        email: s.email,
        title: s.title,
      })),
      contact: contactFacts,
      matter: null,
    })
    placements = placements.map((p) => {
      const value = resolved[p.id]
      return value ? { ...p, value } : p
    })
  }

  // ESIGN-UNIFY-1 (ES-1, §5.5) — converge on the ONE builder the draft path
  // uses; roles/placements/message ride the same esign.send payload.
  // ES-MULTIDOC-1: pass the full ordered document set; the builder writes one
  // envelope_of per document. documents[0] is the primary (matter/version the
  // envelope entity keys on).
  const built = await buildAndSubmitEnvelope(ctx, {
    documentEntityId: doc.document_entity_id,
    documentVersionId: versionIds[0]!,
    documents: docs.map((d, i) => ({
      documentEntityId: d.document_entity_id,
      documentVersionId: versionIds[i]!,
    })),
    matterEntityId: doc.matter_entity_id,
    provider: 'native',
    dispatched: true,
    subject,
    recipients: signers,
    fields: [],
    placements,
    message: input.message ?? null,
  })
  const envelopeId = built.envelopeId
  const requestIds = built.requestIds
  const deliveredIds = built.deliveredRequestIds

  const targets = envelopeId ? await notifyDelivered(ctx, envelopeId, deliveredIds) : []
  const urlByRequest = new Map(targets.map((t) => [t.requestId, t.url]))

  return {
    envelopeId,
    documentVersionId: versionIds[0]!,
    signerCount: signers.length,
    signers: signers.map((s, i) => {
      const requestId = requestIds[i] ?? ''
      return {
        email: s.email,
        channel: s.channel,
        order: s.order,
        delivered: deliveredIds.includes(requestId),
        url: urlByRequest.get(requestId),
      }
    }),
    savedContacts: built.createdContacts,
  }
}

// ── File resolution for the streaming routes ─────────────────────────────────

export interface EnvelopeFileRef {
  objectKey: string
  contentType: string
  filename: string
}

/** ES-MULTIDOC-1 — every stored file behind an envelope's documents, in send
 *  order (the `order` on each envelope_of relationship). A markdown-draft
 *  document contributes no entry (null object_key). Tenant-scoped via RLS; the
 *  caller owns byte access (lib/documentStorage) and response headers. */
export async function loadEnvelopeFileRefs(
  ctx: ActionContext,
  envelopeId: string,
): Promise<EnvelopeFileRef[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      object_key: string | null
      content_type: string | null
      filename: string | null
    }>(
      `SELECT dv.metadata->>'object_key' AS object_key,
              COALESCE(dv.metadata->>'content_type', cb.content_type) AS content_type,
              dv.metadata->>'original_filename' AS filename
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
    return res.rows
      .filter((row) => row.object_key)
      .map((row) => ({
        objectKey: row.object_key!,
        contentType: row.content_type ?? 'application/pdf',
        filename: row.filename ?? 'document.pdf',
      }))
  })
}

/** The stored file behind ONE of an envelope's documents (default: the primary,
 *  order-0). `docIndex` selects a document in a multi-document envelope; out of
 *  range or a markdown-draft document ⇒ null. A single-document envelope with
 *  docIndex 0 returns exactly what the pre-multidoc single-ref loader did. */
export async function loadEnvelopeFileRef(
  ctx: ActionContext,
  envelopeId: string,
  docIndex = 0,
): Promise<EnvelopeFileRef | null> {
  const refs = await loadEnvelopeFileRefs(ctx, envelopeId)
  return refs[docIndex] ?? null
}

/** Token door for the public signer's file view: verify the signed token, then
 *  resolve the envelope's file(s) under the token's tenant. */
export async function loadEnvelopeFileRefByToken(
  token: string,
  docIndex = 0,
): Promise<EnvelopeFileRef | null> {
  const tok = verifySigningToken(token)
  return loadEnvelopeFileRef(signingCtx(tok.tenantId), tok.envelopeId, docIndex)
}

/** Token door for all of an envelope's files, in order (multi-doc signer view). */
export async function loadEnvelopeFileRefsByToken(token: string): Promise<EnvelopeFileRef[]> {
  const tok = verifySigningToken(token)
  return loadEnvelopeFileRefs(signingCtx(tok.tenantId), tok.envelopeId)
}
