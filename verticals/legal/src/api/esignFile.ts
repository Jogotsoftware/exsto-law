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
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { assertCanSendOnMatter } from './matterAccess.js'
import { notifyDelivered, signingCtx } from './esign.js'
import { verifySigningToken } from '../esign/index.js'

export interface FileSigner {
  email: string
  name?: string
  title?: string
  order?: number
}

export interface SendFileForSignatureInput {
  /** The uploaded document_version to send (metadata.object_key present). */
  documentVersionId: string
  signers: FileSigner[]
  subject?: string
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
              m.target_entity_id AS matter_entity_id
         FROM document_version dv
         JOIN content_blob cb ON cb.id = dv.content_blob_id
         LEFT JOIN relationship m ON m.source_entity_id = dv.document_entity_id
           AND m.tenant_id = dv.tenant_id
           AND (m.valid_to IS NULL OR m.valid_to > now())
           AND m.relationship_kind_id =
               (SELECT id FROM relationship_kind_definition
                 WHERE kind_name = 'document_of' AND tenant_id = $1 LIMIT 1)
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
  const doc = await loadUploadedVersion(ctx, input.documentVersionId)
  if (!doc?.object_key) {
    throw new Error(`Uploaded document version not found: ${input.documentVersionId}`)
  }
  if (doc.content_type !== 'application/pdf') {
    throw new Error('Only PDF documents can be sent for signature this way.')
  }
  // Send authz mirrors the draft path: a matter-attached upload dispatches under
  // the matter's ownership gate; a standalone upload has no ownership to gate.
  if (doc.matter_entity_id) await assertCanSendOnMatter(ctx, doc.matter_entity_id)

  const signers = (input.signers ?? [])
    .filter((s) => s.email?.trim())
    .map((s, i) => ({
      email: s.email.trim(),
      name: s.name?.trim() || null,
      key: null,
      title: s.title?.trim() || null,
      order: s.order ?? i + 1,
      channel: 'link' as const,
    }))
  if (signers.length === 0) throw new Error('Add at least one signer with an email address.')

  const subject =
    input.subject?.trim() || `Signature requested: ${doc.filename ?? 'uploaded document'}`

  const result = await submitAction(ctx, {
    actionKindName: 'esign.send',
    intentKind: 'enforcement',
    payload: {
      document_entity_id: doc.document_entity_id,
      document_version_id: input.documentVersionId,
      matter_entity_id: doc.matter_entity_id,
      provider: 'native',
      provider_envelope_ref: null,
      dispatched: true,
      correlation_id: randomUUID(),
      subject,
      signers,
      fields: [],
      save_signers_as_contacts: true,
    },
  })
  const eff = (result.effects[0] ?? {}) as {
    envelopeId?: string
    requestIds?: string[]
    deliveredRequestIds?: string[]
    createdContacts?: Array<{ email: string; contactEntityId: string }>
  }
  const envelopeId = eff.envelopeId ?? ''
  const requestIds = eff.requestIds ?? []
  const deliveredIds = eff.deliveredRequestIds ?? []

  const targets = envelopeId ? await notifyDelivered(ctx, envelopeId, deliveredIds) : []
  const urlByRequest = new Map(targets.map((t) => [t.requestId, t.url]))

  return {
    envelopeId,
    documentVersionId: input.documentVersionId,
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
    savedContacts: eff.createdContacts ?? [],
  }
}

// ── File resolution for the streaming routes ─────────────────────────────────

export interface EnvelopeFileRef {
  objectKey: string
  contentType: string
  filename: string
}

/** The stored file behind an envelope's document (latest non-executed version),
 *  or null when the envelope executes a markdown draft. Tenant-scoped via RLS;
 *  the caller owns byte access (lib/documentStorage) and response headers. */
export async function loadEnvelopeFileRef(
  ctx: ActionContext,
  envelopeId: string,
): Promise<EnvelopeFileRef | null> {
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
         JOIN document_version dv ON dv.document_entity_id = r.target_entity_id
           AND dv.tenant_id = r.tenant_id AND (dv.metadata->>'executed') IS DISTINCT FROM 'true'
         JOIN content_blob cb ON cb.id = dv.content_blob_id
        WHERE r.tenant_id = $1 AND r.source_entity_id = $2
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY dv.version_number DESC LIMIT 1`,
      [ctx.tenantId, envelopeId],
    )
    const row = res.rows[0]
    if (!row?.object_key) return null
    return {
      objectKey: row.object_key,
      contentType: row.content_type ?? 'application/pdf',
      filename: row.filename ?? 'document.pdf',
    }
  })
}

/** Token door for the public signer's file view: verify the signed token, then
 *  resolve the envelope's file under the token's tenant. Null when the token's
 *  envelope isn't a file envelope. Throws on a bad/expired token. */
export async function loadEnvelopeFileRefByToken(token: string): Promise<EnvelopeFileRef | null> {
  const tok = verifySigningToken(token)
  return loadEnvelopeFileRef(signingCtx(tok.tenantId), tok.envelopeId)
}
