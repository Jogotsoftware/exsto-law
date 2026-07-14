// E-signature API (Session 5). NATIVE sign-by-link with DocuSign-style fields,
// per-signer titles, sequential routing, and delivered/opened/signed status.
// All writes go through the operation core (submitAction).
//
// Surfaces:
//   • Portal (authenticated): clients sign inside the client portal — the routes
//     pass a ClientPrincipal (from the portal session) and we authorize that the
//     signed-in client owns the request. Primary path.
//   • Link (token): non-portal signers get an emailed secure link (/sign/<token>),
//     verified by HMAC. Fallback path.
// Both record the same esign.sign / esign.decline / esign.open actions.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { getDraftVersion } from '../queries/drafts.js'
import { getMatter } from '../queries/matters.js'
import { loadConnection } from '../adapters/connectionStore.js'
import { ingestionContext } from './granolaIngestion.js'
import { queueNotification } from './notifications.js'
import { findClientContactByEmail } from './clientIdentity.js'
import { assertCanSendOnMatter } from './matterAccess.js'
import {
  DEFAULT_ESIGN_PROVIDER,
  EsignNotConfiguredError,
  getEsignDriver,
  signSigningToken,
  verifySigningToken,
  type EsignCallbackEvent,
} from '../esign/index.js'
import {
  FILLABLE_FIELD_TYPES,
  labelFor,
  parseFields,
  type EsignField,
  type EsignFieldType,
} from '../esign/fields.js'

const SIGNING_ACTOR = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.URL ??
    'https://exstolaw.netlify.app'
  ).replace(/\/$/, '')
}

function signingCtx(tenantId: string): ActionContext {
  return { tenantId, actorId: SIGNING_ACTOR }
}

/** The signed-in client portal identity, passed by portal routes. */
export interface ClientPrincipal {
  tenantId: string
  clientContactId: string
  email: string
  matterIds: string[]
}

export interface PrepareSigner {
  email: string
  name?: string
  title?: string
  order?: number
  /** Field key the document tags reference ({{type:key}}). Defaults for 1 signer. */
  key?: string
}

export interface SendForSignatureInput {
  documentVersionId: string
  /** The document with field tags inserted (from the prepare UI); a new version
   *  is recorded if it differs from the current body. Omit to sign as-is. */
  preparedMarkdown?: string
  signers?: PrepareSigner[]
  subject?: string
  /** Override provider; defaults to 'native'. */
  provider?: string
}

export interface SendForSignatureResult {
  envelopeId: string
  documentVersionId: string
  provider: string
  signerCount: number
  fieldCount: number
  /** Per signer: how they were routed/notified (url present once delivered). */
  signers: Array<{
    email: string
    channel: 'portal' | 'link'
    order: number
    delivered: boolean
    url?: string
  }>
  dispatched: boolean
  activation?: string
}

export async function sendForSignature(
  ctx: ActionContext,
  input: SendForSignatureInput,
): Promise<SendForSignatureResult> {
  const draft = await getDraftVersion(ctx, input.documentVersionId)
  if (!draft) throw new Error(`Document version not found: ${input.documentVersionId}`)

  // Send authz (0088, PR B): dispatching a signature request emails the matter's
  // client, so only the matter owner / a granted attorney / a firm admin may do it.
  // (Matterless drafts have no ownership to gate; they fall through.)
  if (draft.matterEntityId) await assertCanSendOnMatter(ctx, draft.matterEntityId)

  // Resolve signers (default to the matter's client contact).
  let signers: PrepareSigner[] = (input.signers ?? []).filter((s) => s.email?.trim())
  if (signers.length === 0) {
    const matter = draft.matterEntityId ? await getMatter(ctx, draft.matterEntityId) : null
    const email = matter?.clientEmail?.trim()
    if (!email) {
      throw new Error(
        'No signer specified and no client email on file for the matter. Add signers, or set a client email.',
      )
    }
    signers = [{ email, name: matter?.clientName || undefined }]
  }

  // If the prepare UI added field tags, persist that as a new document version.
  let documentVersionId = input.documentVersionId
  let body = draft.bodyMarkdown
  if (input.preparedMarkdown != null && input.preparedMarkdown !== draft.bodyMarkdown) {
    const edit = await submitAction(ctx, {
      actionKindName: 'document.edit',
      intentKind: 'correction',
      payload: {
        document_version_id: input.documentVersionId,
        document_markdown: input.preparedMarkdown,
        note: 'prepared for signature',
      },
    })
    const ee = (edit.effects[0] ?? {}) as { documentVersionId?: string }
    documentVersionId = ee.documentVersionId ?? documentVersionId
    body = input.preparedMarkdown
  }

  // Parse fields and bind signer keys.
  const fields = parseFields(body)
  const distinctKeys = [...new Set(fields.map((f) => f.signerKey))]
  signers = signers.map((s, i) => ({
    ...s,
    key: s.key ?? (signers.length === 1 ? (distinctKeys[0] ?? 'client') : s.key),
    order: s.order ?? i + 1,
  }))
  if (fields.length && signers.some((s) => !s.key)) {
    throw new Error('Each signer needs a key matching the document field tags ({{type:key}}).')
  }
  for (const k of distinctKeys) {
    if (!signers.some((s) => s.key === k)) {
      throw new Error(
        `The document has fields for signer "${k}" but no signer with that key was added.`,
      )
    }
  }

  // Auto-detect the signing channel: known active client → portal; else link.
  const withChannel = await Promise.all(
    signers.map(async (s) => {
      const contact = await findClientContactByEmail(s.email).catch(() => null)
      return { ...s, channel: (contact ? 'portal' : 'link') as 'portal' | 'link' }
    }),
  )

  const provider = input.provider ?? DEFAULT_ESIGN_PROVIDER
  const subject =
    input.subject ??
    `Signature requested: ${draft.documentKind.replace(/_/g, ' ')} — ${draft.matterNumber}`

  // External provider gate (dormant): only native dispatches without a host.
  let dispatched = provider === 'native'
  let providerEnvelopeRef: string | null = null
  let activation: string | undefined
  if (provider !== 'native') {
    const driver = getEsignDriver(provider)
    const connected =
      provider === 'stub' ? true : Boolean(await loadConnection(ctx.tenantId, provider))
    if (connected) {
      try {
        const d = await driver.sendEnvelope(ctx.tenantId, {
          subject,
          document: { contentType: 'text/markdown', body, filename: `${draft.documentKind}.md` },
          signers: withChannel,
          correlationId: randomUUID(),
        })
        dispatched = true
        providerEnvelopeRef = d.providerEnvelopeRef
      } catch (err) {
        if (err instanceof EsignNotConfiguredError) activation = err.message
        else throw err
      }
    } else {
      activation = `'${provider}' is not connected — recorded as pending_dispatch, not sent.`
    }
  }

  const result = await submitAction(ctx, {
    actionKindName: 'esign.send',
    intentKind: 'enforcement',
    payload: {
      document_entity_id: draft.documentEntityId,
      document_version_id: documentVersionId,
      matter_entity_id: draft.matterEntityId ?? null,
      provider,
      provider_envelope_ref: providerEnvelopeRef,
      dispatched,
      correlation_id: randomUUID(),
      subject,
      signers: withChannel.map((s) => ({
        email: s.email,
        name: s.name ?? null,
        key: s.key ?? null,
        title: s.title ?? null,
        order: s.order ?? null,
        channel: s.channel,
      })),
      fields,
    },
  })
  const eff = (result.effects[0] ?? {}) as {
    envelopeId?: string
    requestIds?: string[]
    deliveredRequestIds?: string[]
  }
  const envelopeId = eff.envelopeId ?? ''
  const requestIds = eff.requestIds ?? []
  const deliveredIds = eff.deliveredRequestIds ?? []

  const targets =
    provider === 'native' && envelopeId ? await notifyDelivered(ctx, envelopeId, deliveredIds) : []
  const urlByRequest = new Map(targets.map((t) => [t.requestId, t.url]))

  return {
    envelopeId,
    documentVersionId,
    provider,
    signerCount: withChannel.length,
    fieldCount: fields.length,
    signers: withChannel.map((s, i) => {
      const requestId = requestIds[i] ?? ''
      return {
        email: s.email,
        channel: s.channel,
        order: s.order ?? i + 1,
        delivered: deliveredIds.includes(requestId),
        // Link/portal URL, present only for signers delivered now (their turn).
        url: urlByRequest.get(requestId),
      }
    }),
    dispatched,
    activation,
  }
}

// Notify the freshly-delivered signers: portal signers get a "sign in" nudge,
// link signers get an emailed secure /sign/<token> link. Returns the per-request
// destination URLs so the caller (attorney) can also surface them.
async function notifyDelivered(
  ctx: ActionContext,
  envelopeId: string,
  requestIds: string[],
): Promise<Array<{ requestId: string; channel: 'portal' | 'link'; url: string }>> {
  if (requestIds.length === 0) return []
  const title =
    (await withActionContext(ctx, (c) =>
      latestAttr(c, ctx.tenantId, envelopeId, 'envelope_subject'),
    )) ?? 'your document'
  const out: Array<{ requestId: string; channel: 'portal' | 'link'; url: string }> = []
  for (const requestId of requestIds) {
    const info = await withActionContext(ctx, async (c) => ({
      email: await latestAttr(c, ctx.tenantId, requestId, 'signer_email'),
      name: await latestAttr(c, ctx.tenantId, requestId, 'signer_name'),
      channel: await latestAttr(c, ctx.tenantId, requestId, 'signer_channel'),
    }))
    if (!info.email) continue
    if (info.channel === 'portal') {
      const url = `${baseUrl()}/portal/sign/${requestId}`
      await queueNotification(ctx, {
        routeKindName: 'esign_sign_request_portal',
        to: info.email,
        variables: { signer_name: info.name ?? info.email, portal_url: url, document_title: title },
      })
      out.push({ requestId, channel: 'portal', url })
    } else {
      const token = signSigningToken({ requestId, envelopeId, tenantId: ctx.tenantId })
      const url = `${baseUrl()}/sign/${encodeURIComponent(token)}`
      await queueNotification(ctx, {
        routeKindName: 'esign_sign_request',
        to: info.email,
        variables: { signer_name: info.name ?? info.email, sign_url: url, document_title: title },
      })
      out.push({ requestId, channel: 'link', url })
    }
  }
  return out
}

// ── Status (attorney view) ────────────────────────────────────────────────────

export interface EnvelopeSignerStatus {
  requestId: string
  name: string | null
  email: string | null
  title: string | null
  order: number
  channel: string | null
  status: string
  signedAt: string | null
}
export interface EnvelopeStatus {
  envelopeId: string
  status: string | null
  subject: string | null
  signers: EnvelopeSignerStatus[]
  // The document this envelope executes, and — once `completed` — the executed
  // copy (a document_version with metadata.executed = 'true') for the review step.
  documentEntityId: string | null
  executedDocumentVersionId: string | null
}

export async function getEnvelopeStatus(
  ctx: ActionContext,
  envelopeId: string,
): Promise<EnvelopeStatus> {
  return withActionContext(ctx, async (client) => {
    const subject = await latestAttr(client, ctx.tenantId, envelopeId, 'envelope_subject')
    const status = await latestAttr(client, ctx.tenantId, envelopeId, 'envelope_status')
    const doc = await client.query<{
      document_entity_id: string
      executed_version_id: string | null
    }>(
      `SELECT r.target_entity_id AS document_entity_id,
              (SELECT dv.id FROM document_version dv
                 WHERE dv.document_entity_id = r.target_entity_id AND dv.tenant_id = $1
                   AND (dv.metadata->>'executed') = 'true'
                 ORDER BY dv.version_number DESC LIMIT 1) AS executed_version_id
         FROM relationship r
         JOIN relationship_kind_definition rkd
           ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'envelope_of'
        WHERE r.tenant_id = $1 AND r.source_entity_id = $2
          AND (r.valid_to IS NULL OR r.valid_to > now())
        LIMIT 1`,
      [ctx.tenantId, envelopeId],
    )
    const a = (k: string) =>
      `(SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
          ON akd.id = a.attribute_kind_id AND akd.kind_name = '${k}'
          WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
          ORDER BY a.valid_from DESC LIMIT 1)`
    const res = await client.query<{
      request_id: string
      name: string | null
      email: string | null
      title: string | null
      ord: string | null
      channel: string | null
      status: string | null
      signed_at: string | null
    }>(
      `SELECT r.source_entity_id AS request_id, ${a('signer_name')} AS name,
              ${a('signer_email')} AS email, ${a('signer_title')} AS title,
              ${a('signer_order')} AS ord, ${a('signer_channel')} AS channel,
              ${a('signer_status')} AS status, ${a('signed_at')} AS signed_at
       FROM relationship r
       JOIN relationship_kind_definition rkd
         ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY ${a('signer_order')} NULLS LAST, r.recorded_at`,
      [ctx.tenantId, envelopeId],
    )
    return {
      envelopeId,
      status,
      subject,
      documentEntityId: doc.rows[0]?.document_entity_id ?? null,
      executedDocumentVersionId: doc.rows[0]?.executed_version_id ?? null,
      signers: res.rows.map((row) => ({
        requestId: row.request_id,
        name: row.name,
        email: row.email,
        title: row.title,
        order: Number(row.ord) || 1,
        channel: row.channel,
        status: row.status ?? 'pending',
        signedAt: row.signed_at,
      })),
    }
  })
}

// ── Signable document + the signer's fields ──────────────────────────────────

export interface SignableDocument {
  requestId: string
  envelopeId: string
  documentTitle: string
  bodyMarkdown: string
  signerName: string | null
  signerEmail: string | null
  signerTitle: string | null
  signerStatus: string
  envelopeStatus: string | null
  /** Fillable fields for this signer (sign/initial/title/text/check). */
  fields: Array<{ id: string; type: EsignFieldType; label: string; prefill?: string }>
  /** True when this signer can act now (their turn, not yet resolved). */
  canSign: boolean
  alreadyResolved: boolean
}

async function buildSignable(ctx: ActionContext, requestId: string): Promise<SignableDocument> {
  return withActionContext(ctx, async (client) => {
    const envelopeId = await requestEnvelopeId(client, ctx.tenantId, requestId)
    if (!envelopeId) throw new Error('Signing request not found.')
    const signerKey = await latestAttr(client, ctx.tenantId, requestId, 'signer_key')
    const signerStatus =
      (await latestAttr(client, ctx.tenantId, requestId, 'signer_status')) ?? 'pending'
    const signerTitle = await latestAttr(client, ctx.tenantId, requestId, 'signer_title')
    const envelopeStatus = await latestAttr(client, ctx.tenantId, envelopeId, 'envelope_status')
    const docRes = await client.query<{ body: string }>(
      `SELECT cb.body FROM relationship r
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
    const fieldsJson = await latestAttrRaw(client, ctx.tenantId, envelopeId, 'envelope_fields')
    const allFields: EsignField[] = fieldsJson ? (JSON.parse(fieldsJson) as EsignField[]) : []
    const myFields = allFields
      .filter((f) => f.signerKey === signerKey && FILLABLE_FIELD_TYPES.includes(f.type))
      .map((f) => ({
        id: f.id,
        type: f.type,
        label: labelFor(f.type),
        prefill: f.type === 'title' ? (signerTitle ?? undefined) : undefined,
      }))
    return {
      requestId,
      envelopeId,
      documentTitle:
        (await latestAttr(client, ctx.tenantId, envelopeId, 'envelope_subject')) ?? 'Document',
      bodyMarkdown: docRes.rows[0]?.body ?? '',
      signerName: await latestAttr(client, ctx.tenantId, requestId, 'signer_name'),
      signerEmail: await latestAttr(client, ctx.tenantId, requestId, 'signer_email'),
      signerTitle,
      signerStatus,
      envelopeStatus,
      fields: myFields,
      canSign: signerStatus === 'delivered' || signerStatus === 'opened',
      alreadyResolved:
        signerStatus === 'signed' ||
        signerStatus === 'declined' ||
        envelopeStatus === 'completed' ||
        envelopeStatus === 'declined',
    }
  })
}

// ── Token (link) surface ──────────────────────────────────────────────────────

export async function loadSignableDocument(
  token: string,
  signerIp?: string | null,
): Promise<SignableDocument> {
  const tok = verifySigningToken(token)
  const ctx = signingCtx(tok.tenantId)
  await recordOpen(ctx, tok.requestId, tok.envelopeId, signerIp)
  return buildSignable(ctx, tok.requestId)
}

export interface RecordSignatureInput {
  token: string
  signatureName: string
  signatureData?: string | null
  consent: string
  fieldValues?: Record<string, string>
  /** Requester IP, captured by the route for the audit trail (PORTAL-1 WP2). */
  signerIp?: string | null
}
export interface RecordSignatureResult {
  ok: boolean
  completed: boolean
  envelopeId: string
  executedDocumentVersionId?: string | null
}

export async function recordSignature(input: RecordSignatureInput): Promise<RecordSignatureResult> {
  const tok = verifySigningToken(input.token)
  const ctx = signingCtx(tok.tenantId)
  return signRequest(ctx, tok.requestId, tok.envelopeId, {
    signatureName: input.signatureName,
    signatureData: input.signatureData ?? null,
    consent: input.consent,
    fieldValues: input.fieldValues,
    signerIp: input.signerIp ?? null,
  })
}

export async function declineSignature(input: {
  token: string
  reason?: string
  signerIp?: string | null
}): Promise<{ ok: boolean; envelopeId: string }> {
  const tok = verifySigningToken(input.token)
  const ctx = signingCtx(tok.tenantId)
  await declineRequest(ctx, tok.requestId, tok.envelopeId, input.reason, input.signerIp ?? null)
  return { ok: true, envelopeId: tok.envelopeId }
}

// ── Portal (authenticated) surface ────────────────────────────────────────────

export interface PendingSignature {
  requestId: string
  envelopeId: string
  documentTitle: string | null
  status: string
}

export async function listClientSignatures(p: ClientPrincipal): Promise<PendingSignature[]> {
  const ctx = signingCtx(p.tenantId)
  if (p.matterIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      request_id: string
      envelope_id: string
      status: string
      matter_id: string | null
      matter_number: string | null
    }>(
      `SELECT req.source_entity_id AS request_id, env.id AS envelope_id,
              m.id AS matter_id, m.name AS matter_number,
              (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
                 ON akd.id=a.attribute_kind_id AND akd.kind_name='signer_status'
                 WHERE a.entity_id=req.source_entity_id AND a.tenant_id=$1
                 ORDER BY a.valid_from DESC LIMIT 1) AS status
       FROM relationship req
       JOIN relationship_kind_definition reqk ON reqk.id=req.relationship_kind_id AND reqk.kind_name='request_of'
       JOIN entity env ON env.id=req.target_entity_id
       JOIN relationship eo ON eo.source_entity_id=env.id AND eo.tenant_id=env.tenant_id
       JOIN relationship_kind_definition eok ON eok.id=eo.relationship_kind_id AND eok.kind_name='envelope_of'
       JOIN relationship df ON df.source_entity_id=eo.target_entity_id AND df.tenant_id=env.tenant_id
       JOIN relationship_kind_definition dfk ON dfk.id=df.relationship_kind_id AND dfk.kind_name='draft_of'
       JOIN attribute em ON em.entity_id=req.source_entity_id AND em.tenant_id=$1
       JOIN attribute_kind_definition emk ON emk.id=em.attribute_kind_id AND emk.kind_name='signer_email'
       LEFT JOIN entity m ON m.id=df.target_entity_id
       WHERE req.tenant_id=$1 AND df.target_entity_id = ANY($2)
         AND lower(em.value #>> '{}') = lower($3)
         AND (em.valid_to IS NULL OR em.valid_to > now())
         AND (eo.valid_to IS NULL OR eo.valid_to > now())`,
      [p.tenantId, p.matterIds, p.email],
    )
    const out: PendingSignature[] = []
    for (const row of res.rows) {
      if (row.status !== 'delivered' && row.status !== 'opened') continue
      const title = await withActionContext(ctx, (c) =>
        latestAttr(c, p.tenantId, row.envelope_id, 'envelope_subject'),
      )
      out.push({
        requestId: row.request_id,
        envelopeId: row.envelope_id,
        documentTitle: title,
        status: row.status,
      })
    }
    return out
  })
}

export interface ClientDocument {
  requestId: string
  envelopeId: string
  documentTitle: string | null
  /** The matter the signed document belongs to (the client's own). */
  matterEntityId: string | null
  matterNumber: string | null
  /** Client-facing state derived from signer_status (never the raw key). */
  state: 'awaiting_you' | 'signed' | 'declined' | 'in_progress'
  /** Raw signer_status (for the portal to pick the right action link). */
  rawStatus: string
}

// Every document the signed-in client is a signer on, across their matters and
// ALL statuses (to-sign AND already-signed/declined). Same relationship graph
// and email-binding as listClientSignatures — these are documents explicitly
// sent to THIS client's email, so they are client-visible by construction. The
// portal "Documents" surface renders this; the to-sign subset still drives the
// dedicated /portal/sign page.
export async function listClientDocuments(p: ClientPrincipal): Promise<ClientDocument[]> {
  const ctx = signingCtx(p.tenantId)
  if (p.matterIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      request_id: string
      envelope_id: string
      status: string
      matter_id: string | null
      matter_number: string | null
    }>(
      `SELECT req.source_entity_id AS request_id, env.id AS envelope_id,
              m.id AS matter_id, m.name AS matter_number,
              (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
                 ON akd.id=a.attribute_kind_id AND akd.kind_name='signer_status'
                 WHERE a.entity_id=req.source_entity_id AND a.tenant_id=$1
                 ORDER BY a.valid_from DESC LIMIT 1) AS status
       FROM relationship req
       JOIN relationship_kind_definition reqk ON reqk.id=req.relationship_kind_id AND reqk.kind_name='request_of'
       JOIN entity env ON env.id=req.target_entity_id
       JOIN relationship eo ON eo.source_entity_id=env.id AND eo.tenant_id=env.tenant_id
       JOIN relationship_kind_definition eok ON eok.id=eo.relationship_kind_id AND eok.kind_name='envelope_of'
       JOIN relationship df ON df.source_entity_id=eo.target_entity_id AND df.tenant_id=env.tenant_id
       JOIN relationship_kind_definition dfk ON dfk.id=df.relationship_kind_id AND dfk.kind_name='draft_of'
       JOIN attribute em ON em.entity_id=req.source_entity_id AND em.tenant_id=$1
       JOIN attribute_kind_definition emk ON emk.id=em.attribute_kind_id AND emk.kind_name='signer_email'
       LEFT JOIN entity m ON m.id=df.target_entity_id
       WHERE req.tenant_id=$1 AND df.target_entity_id = ANY($2)
         AND lower(em.value #>> '{}') = lower($3)
         AND (em.valid_to IS NULL OR em.valid_to > now())
         AND (eo.valid_to IS NULL OR eo.valid_to > now())`,
      [p.tenantId, p.matterIds, p.email],
    )
    const out: ClientDocument[] = []
    for (const row of res.rows) {
      const raw = row.status ?? ''
      const state: ClientDocument['state'] =
        raw === 'delivered' || raw === 'opened'
          ? 'awaiting_you'
          : raw === 'signed' || raw === 'completed'
            ? 'signed'
            : raw === 'declined'
              ? 'declined'
              : 'in_progress'
      const title = await withActionContext(ctx, (c) =>
        latestAttr(c, p.tenantId, row.envelope_id, 'envelope_subject'),
      )
      out.push({
        requestId: row.request_id,
        envelopeId: row.envelope_id,
        documentTitle: title,
        matterEntityId: row.matter_id,
        matterNumber: row.matter_number,
        state,
        rawStatus: raw,
      })
    }
    return out
  })
}

async function assertClientOwnsRequest(p: ClientPrincipal, requestId: string): Promise<string> {
  const ctx = signingCtx(p.tenantId)
  const ok = await withActionContext(ctx, async (client) => {
    const envelopeId = await requestEnvelopeId(client, p.tenantId, requestId)
    if (!envelopeId) return null
    const email = await latestAttr(client, p.tenantId, requestId, 'signer_email')
    if (!email || email.toLowerCase() !== p.email.toLowerCase()) return null
    // The request's matter must be one the client is on.
    const matterRes = await client.query<{ matter_id: string }>(
      `SELECT df.target_entity_id AS matter_id
         FROM relationship eo
         JOIN relationship_kind_definition eok ON eok.id=eo.relationship_kind_id AND eok.kind_name='envelope_of'
         JOIN relationship df ON df.source_entity_id=eo.target_entity_id AND df.tenant_id=eo.tenant_id
         JOIN relationship_kind_definition dfk ON dfk.id=df.relationship_kind_id AND dfk.kind_name='draft_of'
        WHERE eo.tenant_id=$1 AND eo.source_entity_id=$2 AND (eo.valid_to IS NULL OR eo.valid_to>now())
        LIMIT 1`,
      [p.tenantId, envelopeId],
    )
    const matterId = matterRes.rows[0]?.matter_id
    if (!matterId || !p.matterIds.includes(matterId)) return null
    return envelopeId
  })
  if (!ok) throw new Error('You are not authorized to sign this document.')
  return ok
}

export async function loadSignableForClient(
  p: ClientPrincipal,
  requestId: string,
  signerIp?: string | null,
): Promise<SignableDocument> {
  const envelopeId = await assertClientOwnsRequest(p, requestId)
  const ctx = signingCtx(p.tenantId)
  await recordOpen(ctx, requestId, envelopeId, signerIp)
  return buildSignable(ctx, requestId)
}

export async function recordSignatureForClient(
  p: ClientPrincipal,
  input: {
    requestId: string
    signatureName: string
    signatureData?: string | null
    consent: string
    fieldValues?: Record<string, string>
    signerIp?: string | null
  },
): Promise<RecordSignatureResult> {
  const envelopeId = await assertClientOwnsRequest(p, input.requestId)
  const ctx = signingCtx(p.tenantId)
  return signRequest(ctx, input.requestId, envelopeId, {
    signatureName: input.signatureName,
    signatureData: input.signatureData ?? null,
    consent: input.consent,
    fieldValues: input.fieldValues,
    signerIp: input.signerIp ?? null,
  })
}

export async function declineForClient(
  p: ClientPrincipal,
  input: { requestId: string; reason?: string; signerIp?: string | null },
): Promise<{ ok: boolean; envelopeId: string }> {
  const envelopeId = await assertClientOwnsRequest(p, input.requestId)
  const ctx = signingCtx(p.tenantId)
  await declineRequest(ctx, input.requestId, envelopeId, input.reason, input.signerIp ?? null)
  return { ok: true, envelopeId }
}

// ── Shared sign/decline/open (turn-checked) ──────────────────────────────────

async function signRequest(
  ctx: ActionContext,
  requestId: string,
  envelopeId: string,
  input: {
    signatureName: string
    signatureData?: string | null
    consent: string
    fieldValues?: Record<string, string>
    signerIp?: string | null
  },
): Promise<RecordSignatureResult> {
  if (!input.signatureName?.trim()) throw new Error('A signature (typed name) is required.')
  if (!input.consent?.trim()) throw new Error('Consent to sign electronically is required.')
  await assertSignerTurn(ctx, requestId)
  const result = await submitAction(ctx, {
    actionKindName: 'esign.sign',
    intentKind: 'enforcement',
    payload: {
      request_entity_id: requestId,
      envelope_entity_id: envelopeId,
      signature_name: input.signatureName.trim(),
      signature_data: input.signatureData ?? null,
      consent_text: input.consent.trim(),
      field_values: input.fieldValues ?? null,
      signer_ip: input.signerIp ?? null,
    },
  })
  const eff = (result.effects[0] ?? {}) as {
    completed?: boolean
    executedDocumentVersionId?: string | null
    deliveredRequestIds?: string[]
  }
  // Sequential routing: notify the next group that just became active.
  await notifyDelivered(ctx, envelopeId, eff.deliveredRequestIds ?? [])
  return {
    ok: true,
    completed: Boolean(eff.completed),
    envelopeId,
    executedDocumentVersionId: eff.executedDocumentVersionId ?? null,
  }
}

async function declineRequest(
  ctx: ActionContext,
  requestId: string,
  envelopeId: string,
  reason?: string,
  signerIp?: string | null,
): Promise<void> {
  await assertSignerTurn(ctx, requestId)
  await submitAction(ctx, {
    actionKindName: 'esign.decline',
    intentKind: 'adjustment',
    payload: {
      request_entity_id: requestId,
      envelope_entity_id: envelopeId,
      reason: reason ?? null,
      signer_ip: signerIp ?? null,
    },
  })
}

async function recordOpen(
  ctx: ActionContext,
  requestId: string,
  envelopeId: string,
  signerIp?: string | null,
): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'esign.open',
    intentKind: 'automatic_sync',
    payload: {
      request_entity_id: requestId,
      envelope_entity_id: envelopeId,
      signer_ip: signerIp ?? null,
    },
  })
}

async function assertSignerTurn(ctx: ActionContext, requestId: string): Promise<void> {
  const status = await withActionContext(ctx, (c) =>
    latestAttr(c, ctx.tenantId, requestId, 'signer_status'),
  )
  if (status === 'signed' || status === 'declined') {
    throw new Error('This request has already been completed.')
  }
  if (status === 'pending') {
    throw new Error('It is not your turn to sign yet — a prior signer must sign first.')
  }
}

// ── small read helpers ────────────────────────────────────────────────────────

async function latestAttr(
  client: DbClient,
  tenantId: string,
  entityId: string,
  kind: string,
): Promise<string | null> {
  const res = await client.query<{ value: string }>(
    `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = $3
      ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, entityId, kind],
  )
  return res.rows[0]?.value ?? null
}

async function latestAttrRaw(
  client: DbClient,
  tenantId: string,
  entityId: string,
  kind: string,
): Promise<string | null> {
  const res = await client.query<{ value: string }>(
    `SELECT a.value::text AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = $3
      ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, entityId, kind],
  )
  return res.rows[0]?.value ?? null
}

async function requestEnvelopeId(
  client: DbClient,
  tenantId: string,
  requestId: string,
): Promise<string | null> {
  const res = await client.query<{ envelope_id: string }>(
    `SELECT r.target_entity_id AS envelope_id FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
      WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND (r.valid_to IS NULL OR r.valid_to > now())
      LIMIT 1`,
    [tenantId, requestId],
  )
  return res.rows[0]?.envelope_id ?? null
}

// ── External provider callback (dormant) ─────────────────────────────────────

export interface EsignWebhookResult {
  ok: boolean
  status: number
  error?: string
  envelopeId?: string
  recordedStatus?: string
}

export async function handleEsignCallback(
  rawBody: string,
  signature: string | null,
  providerHint?: string,
): Promise<EsignWebhookResult> {
  const ctx = ingestionContext()
  const provider = providerHint ?? 'opensign'
  const driver = getEsignDriver(provider)
  let event: EsignCallbackEvent
  try {
    event = await driver.parseCallback({ tenantId: ctx.tenantId, rawBody, signature })
  } catch (err) {
    if (err instanceof EsignNotConfiguredError)
      return { ok: false, status: 503, error: err.message }
    return {
      ok: false,
      status: 401,
      error: err instanceof Error ? err.message : 'callback rejected',
    }
  }
  const raw = await submitAction(ctx, {
    actionKindName: 'raw_event.ingest',
    intentKind: 'automatic_sync',
    payload: {
      source_type: 'integration',
      source_ref: `integration:${provider}`,
      external_id: event.providerEnvelopeRef ?? event.correlationId ?? null,
      payload: event.raw,
    },
  })
  const rawEventLogId = ((raw.effects[0] ?? {}) as { rawEventLogId?: string }).rawEventLogId ?? null
  if (event.status !== 'signed' && event.status !== 'completed' && event.status !== 'declined') {
    return { ok: true, status: 200, recordedStatus: event.status }
  }
  const envelopeId = await resolveEnvelope(ctx, event.providerEnvelopeRef, event.correlationId)
  if (!envelopeId)
    return { ok: true, status: 202, error: 'no matching envelope (raw payload stored)' }
  await submitAction(ctx, {
    actionKindName: 'esign.record_status',
    intentKind: 'automatic_sync',
    payload: {
      envelope_entity_id: envelopeId,
      provider_envelope_ref: event.providerEnvelopeRef,
      status: event.status,
      signer_email: event.signerEmail ?? null,
      executed_document: event.executedDocument
        ? { content_type: event.executedDocument.contentType, body: event.executedDocument.body }
        : null,
      raw_event_log_id: rawEventLogId,
      source_ref: `integration:${provider}`,
    },
  })
  return { ok: true, status: 200, envelopeId, recordedStatus: event.status }
}

async function resolveEnvelope(
  ctx: ActionContext,
  providerRef: string | null,
  correlationId: string | null | undefined,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    if (providerRef) {
      const byRef = await client.query<{ entity_id: string }>(
        `SELECT a.entity_id FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name = 'provider_envelope_ref'
          WHERE a.tenant_id = $1 AND a.value #>> '{}' = $2 AND (a.valid_to IS NULL OR a.valid_to > now())
          ORDER BY a.valid_from DESC LIMIT 1`,
        [ctx.tenantId, providerRef],
      )
      if (byRef.rows[0]) return byRef.rows[0].entity_id
    }
    if (correlationId) {
      const byCorr = await client.query<{ id: string }>(
        `SELECT e.id FROM entity e
           JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'signature_envelope'
          WHERE e.tenant_id = $1 AND e.metadata->>'correlation_id' = $2 LIMIT 1`,
        [ctx.tenantId, correlationId],
      )
      if (byCorr.rows[0]) return byCorr.rows[0].id
    }
    return null
  })
}
