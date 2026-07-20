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
import { findClientContactByEmailInTenant } from './clientIdentity.js'
import { assertCanSendOnMatter } from './matterAccess.js'
import { getTenantSettings } from './tenantSettings.js'
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
    'https://exsto-law.netlify.app'
  ).replace(/\/$/, '')
}

// Exported for the file-envelope surfaces (esignFile.ts): the public sign
// routes act as the signing system actor, tenant-scoped from the verified token.
export function signingCtx(tenantId: string): ActionContext {
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
  /** 0170: recipients who weren't in contacts yet, saved as new client_contacts. */
  savedContacts: Array<{ email: string; contactEntityId: string }>
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

  // Auto-detect the signing channel: known active client OF THIS FIRM → portal;
  // else link. Tenant-scoped (the sender's tenant is the only one that matters):
  // the old cross-tenant single-firm lookup silently downgraded a person who is
  // also a client at another firm from portal to emailed link.
  const withChannel = await Promise.all(
    signers.map(async (s) => {
      const contact = await findClientContactByEmailInTenant(ctx.tenantId, s.email).catch(
        () => null,
      )
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
    savedContacts: eff.createdContacts ?? [],
  }
}

// Notify the freshly-delivered signers: portal signers get a "sign in" nudge,
// link signers get an emailed secure /sign/<token> link. Returns the per-request
// destination URLs so the caller (attorney) can also surface them.
// Exported for the file-envelope send path (esignFile.ts).
export async function notifyDelivered(
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
  // The field-tag key this signer fills ({{type:key}}); 'attorney'/'firm' marks
  // the firm's own signature slot (used to classify the "action needed" bucket).
  key: string | null
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
  // WP-N detail header: the matter + document + when it was sent, and the derived
  // stat-card/filter bucket (same rule as the list — see classifyEnvelope).
  matterEntityId: string | null
  matterNumber: string | null
  documentKind: string | null
  sentAt: string | null
  bucket: EnvelopeBucket
  // 0170 — file envelopes: the document is a stored PDF (View streams it), and a
  // standalone envelope may be filed under a contact instead of a matter.
  isFile: boolean
  fileName: string | null
  contactEntityId: string | null
  contactName: string | null
  /** File envelopes only, once completed: the executed signature-certificate
   *  markdown (the executed version's body). Drafts keep using legal.draft.get. */
  executedCertificateMarkdown: string | null
}

export async function getEnvelopeStatus(
  ctx: ActionContext,
  envelopeId: string,
): Promise<EnvelopeStatus> {
  return withActionContext(ctx, async (client) => {
    const subject = await latestAttr(client, ctx.tenantId, envelopeId, 'envelope_subject')
    const status = await latestAttr(client, ctx.tenantId, envelopeId, 'envelope_status')
    const meta = await client.query<{ sent_at: string | null }>(
      `SELECT to_char(recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS sent_at
         FROM entity WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [ctx.tenantId, envelopeId],
    )
    const doc = await client.query<{
      document_entity_id: string
      executed_version_id: string | null
      matter_entity_id: string | null
      matter_number: string | null
      document_kind: string | null
      object_key: string | null
      file_name: string | null
      contact_entity_id: string | null
      contact_name: string | null
      executed_body: string | null
    }>(
      `SELECT r.target_entity_id AS document_entity_id,
              coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
              coalesce(df.target_entity_id, du.target_entity_id) AS matter_entity_id,
              coalesce(e_matter.name, e_matter_u.name) AS matter_number,
              dc.target_entity_id AS contact_entity_id,
              e_contact.name AS contact_name,
              (SELECT dv.id FROM document_version dv
                 WHERE dv.document_entity_id = r.target_entity_id AND dv.tenant_id = $1
                   AND (dv.metadata->>'executed') = 'true'
                 ORDER BY dv.version_number DESC LIMIT 1) AS executed_version_id,
              (SELECT dv.metadata->>'object_key' FROM document_version dv
                 WHERE dv.document_entity_id = r.target_entity_id AND dv.tenant_id = $1
                   AND (dv.metadata->>'executed') IS DISTINCT FROM 'true'
                 ORDER BY dv.version_number DESC LIMIT 1) AS object_key,
              (SELECT dv.metadata->>'original_filename' FROM document_version dv
                 WHERE dv.document_entity_id = r.target_entity_id AND dv.tenant_id = $1
                   AND (dv.metadata->>'executed') IS DISTINCT FROM 'true'
                 ORDER BY dv.version_number DESC LIMIT 1) AS file_name,
              (SELECT cb2.body FROM document_version dv2
                 JOIN content_blob cb2 ON cb2.id = dv2.content_blob_id
                 WHERE dv2.document_entity_id = r.target_entity_id AND dv2.tenant_id = $1
                   AND (dv2.metadata->>'executed') = 'true'
                   AND cb2.content_type = 'text/markdown'
                 ORDER BY dv2.version_number DESC LIMIT 1) AS executed_body
         FROM relationship r
         JOIN relationship_kind_definition rkd
           ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'envelope_of'
         LEFT JOIN entity e_doc ON e_doc.id = r.target_entity_id
         LEFT JOIN relationship df ON df.source_entity_id = r.target_entity_id
           AND df.tenant_id = $1 AND (df.valid_to IS NULL OR df.valid_to > now())
           AND df.relationship_kind_id =
               (SELECT id FROM relationship_kind_definition
                 WHERE kind_name = 'draft_of' AND tenant_id = $1 LIMIT 1)
         LEFT JOIN entity e_matter ON e_matter.id = df.target_entity_id
         LEFT JOIN relationship du ON du.source_entity_id = r.target_entity_id
           AND du.tenant_id = $1 AND (du.valid_to IS NULL OR du.valid_to > now())
           AND du.relationship_kind_id =
               (SELECT id FROM relationship_kind_definition
                 WHERE kind_name = 'document_of' AND tenant_id = $1 LIMIT 1)
         LEFT JOIN entity e_matter_u ON e_matter_u.id = du.target_entity_id
         LEFT JOIN relationship dc ON dc.source_entity_id = r.target_entity_id
           AND dc.tenant_id = $1 AND (dc.valid_to IS NULL OR dc.valid_to > now())
           AND dc.relationship_kind_id =
               (SELECT id FROM relationship_kind_definition
                 WHERE kind_name = 'document_of_contact' AND tenant_id = $1 LIMIT 1)
         LEFT JOIN entity e_contact ON e_contact.id = dc.target_entity_id
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
      signer_key: string | null
    }>(
      `SELECT r.source_entity_id AS request_id, ${a('signer_name')} AS name,
              ${a('signer_email')} AS email, ${a('signer_title')} AS title,
              ${a('signer_order')} AS ord, ${a('signer_channel')} AS channel,
              ${a('signer_status')} AS status, ${a('signed_at')} AS signed_at,
              ${a('signer_key')} AS signer_key
       FROM relationship r
       JOIN relationship_kind_definition rkd
         ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY ${a('signer_order')} NULLS LAST, r.recorded_at`,
      [ctx.tenantId, envelopeId],
    )
    const signers = res.rows.map((row) => ({
      requestId: row.request_id,
      name: row.name,
      email: row.email,
      title: row.title,
      order: Number(row.ord) || 1,
      channel: row.channel,
      status: row.status ?? 'pending',
      signedAt: row.signed_at,
      key: row.signer_key,
    }))
    return {
      envelopeId,
      status,
      subject,
      documentEntityId: doc.rows[0]?.document_entity_id ?? null,
      executedDocumentVersionId: doc.rows[0]?.executed_version_id ?? null,
      matterEntityId: doc.rows[0]?.matter_entity_id ?? null,
      matterNumber: doc.rows[0]?.matter_number ?? null,
      documentKind: doc.rows[0]?.document_kind ?? null,
      sentAt: meta.rows[0]?.sent_at ?? null,
      bucket: classifyEnvelope(status ?? 'pending_dispatch', signers),
      isFile: Boolean(doc.rows[0]?.object_key),
      fileName: doc.rows[0]?.file_name ?? null,
      contactEntityId: doc.rows[0]?.contact_entity_id ?? null,
      contactName: doc.rows[0]?.contact_name ?? null,
      executedCertificateMarkdown: doc.rows[0]?.object_key
        ? (doc.rows[0]?.executed_body ?? null)
        : null,
      signers,
    }
  })
}

// ── Envelope list (attorney eSign surface, WP-N) ─────────────────────────────

export interface EnvelopeListSigner {
  name: string | null
  email: string | null
  title: string | null
  order: number
  channel: string | null
  status: string
  key: string | null
  signedAt: string | null
}
/** Which stat-card / filter bucket an envelope falls in on the eSign surface. */
export type EnvelopeBucket = 'action_needed' | 'out' | 'completed' | 'declined' | 'voided'
export interface EnvelopeListItem {
  envelopeId: string
  subject: string | null
  status: string
  bucket: EnvelopeBucket
  documentEntityId: string | null
  documentKind: string | null
  matterEntityId: string | null
  matterNumber: string | null
  // 0170: standalone file envelopes — the contact it's filed under (if any).
  contactEntityId: string | null
  contactName: string | null
  signers: EnvelopeListSigner[]
  signedCount: number
  signerCount: number
  sentAt: string | null
  updatedAt: string | null
}

// A signer whose key marks the FIRM's own signature slot. The prepare flow and
// bundled templates assign 'attorney' to the firm's counter-signature; an
// envelope currently waiting on that signer is blocked on the FIRM (the comp's
// "Action needed" bucket) rather than out for a client's signature.
const FIRM_SIGNER_KEYS = new Set(['attorney', 'firm'])
const ACTIVE_SIGNER = new Set(['delivered', 'opened'])

function classifyEnvelope(status: string, signers: EnvelopeListSigner[]): EnvelopeBucket {
  if (status === 'completed') return 'completed'
  if (status === 'declined') return 'declined'
  if (status === 'voided') return 'voided'
  // Active (sent | pending_dispatch): blocked on the firm iff a currently-active
  // signer holds a firm key; otherwise it is out for a client/external signer.
  const active = signers.filter((s) => ACTIVE_SIGNER.has(s.status))
  if (active.some((s) => s.key != null && FIRM_SIGNER_KEYS.has(s.key))) return 'action_needed'
  return 'out'
}

// Every envelope in the tenant, newest first, with its signers, document, matter,
// and derived bucket — backs the eSign list (stat cards + filter pills + table).
export async function listEnvelopes(ctx: ActionContext): Promise<EnvelopeListItem[]> {
  return withActionContext(ctx, async (client) => {
    // Latest-value scalar subquery for an attribute of the request row `req`.
    const rq = (k: string) =>
      `(SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
          ON akd.id = a.attribute_kind_id AND akd.kind_name = '${k}'
          WHERE a.entity_id = req.source_entity_id AND a.tenant_id = $1
          ORDER BY a.valid_from DESC LIMIT 1)`
    // Latest-value scalar subquery for an attribute of the envelope row `e`.
    const ev = (k: string) =>
      `(SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
          ON akd.id = a.attribute_kind_id AND akd.kind_name = '${k}'
          WHERE a.entity_id = e.id AND a.tenant_id = $1
          ORDER BY a.valid_from DESC LIMIT 1)`
    const res = await client.query<{
      envelope_id: string
      subject: string | null
      status: string | null
      document_entity_id: string | null
      document_kind: string | null
      matter_entity_id: string | null
      matter_number: string | null
      contact_entity_id: string | null
      contact_name: string | null
      sent_at: string
      signers: EnvelopeListSigner[] | null
    }>(
      `SELECT
         e.id AS envelope_id,
         ${ev('envelope_subject')} AS subject,
         ${ev('envelope_status')} AS status,
         eo.target_entity_id AS document_entity_id,
         coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
         coalesce(df.target_entity_id, du.target_entity_id) AS matter_entity_id,
         coalesce(e_matter.name, e_matter_u.name) AS matter_number,
         dc.target_entity_id AS contact_entity_id,
         e_contact.name AS contact_name,
         to_char(e.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS sent_at,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'name', ${rq('signer_name')},
             'email', ${rq('signer_email')},
             'title', ${rq('signer_title')},
             'order', coalesce((${rq('signer_order')})::int, 1),
             'channel', ${rq('signer_channel')},
             'status', coalesce(${rq('signer_status')}, 'pending'),
             'key', ${rq('signer_key')},
             'signedAt', ${rq('signed_at')}
           ) ORDER BY coalesce((${rq('signer_order')})::int, 1), req.recorded_at), '[]'::jsonb)
          FROM relationship req
          JOIN relationship_kind_definition reqk
            ON reqk.id = req.relationship_kind_id AND reqk.kind_name = 'request_of'
          WHERE req.tenant_id = $1 AND req.target_entity_id = e.id
            AND (req.valid_to IS NULL OR req.valid_to > now())) AS signers
       FROM entity e
       JOIN entity_kind_definition ekd
         ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'signature_envelope'
       LEFT JOIN relationship eo
         ON eo.source_entity_id = e.id AND eo.tenant_id = $1
        AND (eo.valid_to IS NULL OR eo.valid_to > now())
        AND eo.relationship_kind_id =
            (SELECT id FROM relationship_kind_definition
              WHERE kind_name = 'envelope_of' AND tenant_id = $1 LIMIT 1)
       LEFT JOIN entity e_doc ON e_doc.id = eo.target_entity_id
       LEFT JOIN relationship df
         ON df.source_entity_id = eo.target_entity_id AND df.tenant_id = $1
        AND (df.valid_to IS NULL OR df.valid_to > now())
        AND df.relationship_kind_id =
            (SELECT id FROM relationship_kind_definition
              WHERE kind_name = 'draft_of' AND tenant_id = $1 LIMIT 1)
       LEFT JOIN entity e_matter ON e_matter.id = df.target_entity_id
       LEFT JOIN relationship du
         ON du.source_entity_id = eo.target_entity_id AND du.tenant_id = $1
        AND (du.valid_to IS NULL OR du.valid_to > now())
        AND du.relationship_kind_id =
            (SELECT id FROM relationship_kind_definition
              WHERE kind_name = 'document_of' AND tenant_id = $1 LIMIT 1)
       LEFT JOIN entity e_matter_u ON e_matter_u.id = du.target_entity_id
       LEFT JOIN relationship dc
         ON dc.source_entity_id = eo.target_entity_id AND dc.tenant_id = $1
        AND (dc.valid_to IS NULL OR dc.valid_to > now())
        AND dc.relationship_kind_id =
            (SELECT id FROM relationship_kind_definition
              WHERE kind_name = 'document_of_contact' AND tenant_id = $1 LIMIT 1)
       LEFT JOIN entity e_contact ON e_contact.id = dc.target_entity_id
       WHERE e.tenant_id = $1
       ORDER BY e.recorded_at DESC`,
      [ctx.tenantId],
    )
    return res.rows.map((row) => {
      const signers = (row.signers ?? []).map((s) => ({
        name: s.name,
        email: s.email,
        title: s.title,
        order: Number(s.order) || 1,
        channel: s.channel,
        status: s.status ?? 'pending',
        key: s.key,
        signedAt: s.signedAt,
      }))
      const status = row.status ?? 'pending_dispatch'
      const signedCount = signers.filter((s) => s.status === 'signed').length
      const signedTimes = signers
        .map((s) => s.signedAt)
        .filter((t): t is string => Boolean(t))
        .sort()
      return {
        envelopeId: row.envelope_id,
        subject: row.subject,
        status,
        bucket: classifyEnvelope(status, signers),
        documentEntityId: row.document_entity_id,
        documentKind: row.document_kind,
        matterEntityId: row.matter_entity_id,
        matterNumber: row.matter_number,
        contactEntityId: row.contact_entity_id,
        contactName: row.contact_name,
        signers,
        signedCount,
        signerCount: signers.length,
        sentAt: row.sent_at,
        updatedAt: signedTimes.length ? signedTimes[signedTimes.length - 1]! : row.sent_at,
      }
    })
  })
}

// ── Resend / Void (attorney actions, WP-N) ───────────────────────────────────

export interface ResendResult {
  envelopeId: string
  notified: number
  signers: Array<{ email: string; channel: 'portal' | 'link' }>
}

// Re-notify the signers whose turn is currently active (delivered | opened) on an
// ACTIVE envelope — the real "resend the signing link" path (re-queues the same
// secure link / portal nudge each active signer already had). Terminal envelopes
// (completed | declined | voided) and pending_dispatch (external, never sent) are
// refused. Goes through the operation core via queueNotification (submitAction).
export async function resendEnvelope(
  ctx: ActionContext,
  envelopeId: string,
): Promise<ResendResult> {
  const status = await withActionContext(ctx, (c) =>
    latestAttr(c, ctx.tenantId, envelopeId, 'envelope_status'),
  )
  if (status !== 'sent') {
    throw new Error(
      status == null
        ? 'Envelope not found.'
        : `Only an envelope that is out for signature can be resent (this one is ${status}).`,
    )
  }
  const activeIds = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ request_id: string }>(
      `SELECT r.source_entity_id AS request_id FROM relationship r
         JOIN relationship_kind_definition rkd
           ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
        WHERE r.tenant_id = $1 AND r.target_entity_id = $2
          AND (r.valid_to IS NULL OR r.valid_to > now())
          AND (SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition akd
                   ON akd.id = a.attribute_kind_id AND akd.kind_name = 'signer_status'
                WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
                ORDER BY a.valid_from DESC LIMIT 1) IN ('delivered', 'opened')`,
      [ctx.tenantId, envelopeId],
    )
    return res.rows.map((r) => r.request_id)
  })
  if (activeIds.length === 0) {
    throw new Error('No signer is currently awaiting signature on this envelope.')
  }
  const targets = await notifyDelivered(ctx, envelopeId, activeIds)
  return {
    envelopeId,
    notified: targets.length,
    signers: targets.map((t) => ({ email: '', channel: t.channel })),
  }
}

export interface VoidResult {
  envelopeId: string
  status: 'voided'
  voidedRequestIds: string[]
}

// Void an active envelope (firm-initiated). Send authz: voiding pulls a document
// back from the client, so gate it like sending — only a matter owner / granted
// attorney / firm admin may void. Routes through the operation core (esign.void).
export async function voidEnvelope(
  ctx: ActionContext,
  envelopeId: string,
  reason?: string,
): Promise<VoidResult> {
  const matterId = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ matter_id: string | null }>(
      `SELECT df.target_entity_id AS matter_id
         FROM relationship eo
         JOIN relationship_kind_definition eok
           ON eok.id = eo.relationship_kind_id AND eok.kind_name = 'envelope_of'
         LEFT JOIN relationship df ON df.source_entity_id = eo.target_entity_id
           AND df.tenant_id = eo.tenant_id
         LEFT JOIN relationship_kind_definition dfk
           ON dfk.id = df.relationship_kind_id AND dfk.kind_name = 'draft_of'
        WHERE eo.tenant_id = $1 AND eo.source_entity_id = $2
          AND (eo.valid_to IS NULL OR eo.valid_to > now())
          AND (df.valid_to IS NULL OR df.valid_to > now())
        LIMIT 1`,
      [ctx.tenantId, envelopeId],
    )
    return res.rows[0]?.matter_id ?? null
  })
  if (matterId) await assertCanSendOnMatter(ctx, matterId)

  const result = await submitAction(ctx, {
    actionKindName: 'esign.void',
    intentKind: 'enforcement',
    payload: { envelope_entity_id: envelopeId, reason: reason ?? null },
  })
  const eff = (result.effects[0] ?? {}) as { voidedRequestIds?: string[] }
  return { envelopeId, status: 'voided', voidedRequestIds: eff.voidedRequestIds ?? [] }
}

// ── Signable document + the signer's fields ──────────────────────────────────

export interface SignableDocument {
  requestId: string
  envelopeId: string
  documentTitle: string
  bodyMarkdown: string
  /** 0170 — uploaded-file envelope: the document is a stored file (PDF), not
   *  markdown. The signer surface renders it via the token-gated file route;
   *  bodyMarkdown is empty and there are no inline fields. */
  isFile: boolean
  fileName: string | null
  fileContentType: string | null
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
  // FB-C — the resolved firm's name (never a hardcoded literal). Backs both
  // signing doors (token link + authed portal), since both call buildSignable.
  // Null when the firm hasn't set one.
  firmName: string | null
}

async function buildSignable(ctx: ActionContext, requestId: string): Promise<SignableDocument> {
  const doc = await withActionContext(ctx, async (client) => {
    const envelopeId = await requestEnvelopeId(client, ctx.tenantId, requestId)
    if (!envelopeId) throw new Error('Signing request not found.')
    const signerKey = await latestAttr(client, ctx.tenantId, requestId, 'signer_key')
    const signerStatus =
      (await latestAttr(client, ctx.tenantId, requestId, 'signer_status')) ?? 'pending'
    const signerTitle = await latestAttr(client, ctx.tenantId, requestId, 'signer_title')
    const envelopeStatus = await latestAttr(client, ctx.tenantId, envelopeId, 'envelope_status')
    const docRes = await client.query<{
      body: string
      object_key: string | null
      content_type: string | null
      original_filename: string | null
    }>(
      `SELECT cb.body,
              dv.metadata->>'object_key' AS object_key,
              COALESCE(dv.metadata->>'content_type', cb.content_type) AS content_type,
              dv.metadata->>'original_filename' AS original_filename
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
    // 0170: an uploaded-file envelope's body is a storage object key, not
    // signable text — flag it so the surfaces render the file instead.
    const isFile = Boolean(docRes.rows[0]?.object_key)
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
      bodyMarkdown: isFile ? '' : (docRes.rows[0]?.body ?? ''),
      isFile,
      fileName: isFile ? (docRes.rows[0]?.original_filename ?? null) : null,
      fileContentType: isFile ? (docRes.rows[0]?.content_type ?? null) : null,
      signerName: await latestAttr(client, ctx.tenantId, requestId, 'signer_name'),
      signerEmail: await latestAttr(client, ctx.tenantId, requestId, 'signer_email'),
      signerTitle,
      signerStatus,
      envelopeStatus,
      fields: myFields,
      canSign:
        (signerStatus === 'delivered' || signerStatus === 'opened') && envelopeStatus !== 'voided',
      alreadyResolved:
        signerStatus === 'signed' ||
        signerStatus === 'declined' ||
        signerStatus === 'voided' ||
        envelopeStatus === 'completed' ||
        envelopeStatus === 'declined' ||
        envelopeStatus === 'voided',
    }
  })

  let firmName: string | null = null
  try {
    firmName = (await getTenantSettings(ctx)).firmName
  } catch {
    firmName = null // degrade to the caller's generic fallback, never guess a name
  }
  return { ...doc, firmName }
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
       LEFT JOIN relationship df ON df.source_entity_id=eo.target_entity_id AND df.tenant_id=env.tenant_id
         AND (df.valid_to IS NULL OR df.valid_to > now())
         AND df.relationship_kind_id =
             (SELECT id FROM relationship_kind_definition
               WHERE kind_name = 'draft_of' AND tenant_id = env.tenant_id LIMIT 1)
       LEFT JOIN relationship du ON du.source_entity_id=eo.target_entity_id AND du.tenant_id=env.tenant_id
         AND (du.valid_to IS NULL OR du.valid_to > now())
         AND du.relationship_kind_id =
             (SELECT id FROM relationship_kind_definition
               WHERE kind_name = 'document_of' AND tenant_id = env.tenant_id LIMIT 1)
       JOIN attribute em ON em.entity_id=req.source_entity_id AND em.tenant_id=$1
       JOIN attribute_kind_definition emk ON emk.id=em.attribute_kind_id AND emk.kind_name='signer_email'
       LEFT JOIN entity m ON m.id = coalesce(df.target_entity_id, du.target_entity_id)
       WHERE req.tenant_id=$1 AND coalesce(df.target_entity_id, du.target_entity_id) = ANY($2)
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
       LEFT JOIN relationship df ON df.source_entity_id=eo.target_entity_id AND df.tenant_id=env.tenant_id
         AND (df.valid_to IS NULL OR df.valid_to > now())
         AND df.relationship_kind_id =
             (SELECT id FROM relationship_kind_definition
               WHERE kind_name = 'draft_of' AND tenant_id = env.tenant_id LIMIT 1)
       LEFT JOIN relationship du ON du.source_entity_id=eo.target_entity_id AND du.tenant_id=env.tenant_id
         AND (du.valid_to IS NULL OR du.valid_to > now())
         AND du.relationship_kind_id =
             (SELECT id FROM relationship_kind_definition
               WHERE kind_name = 'document_of' AND tenant_id = env.tenant_id LIMIT 1)
       JOIN attribute em ON em.entity_id=req.source_entity_id AND em.tenant_id=$1
       JOIN attribute_kind_definition emk ON emk.id=em.attribute_kind_id AND emk.kind_name='signer_email'
       LEFT JOIN entity m ON m.id = coalesce(df.target_entity_id, du.target_entity_id)
       WHERE req.tenant_id=$1 AND coalesce(df.target_entity_id, du.target_entity_id) = ANY($2)
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
  if (status === 'voided') {
    throw new Error('This envelope was voided by the firm and can no longer be signed.')
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
