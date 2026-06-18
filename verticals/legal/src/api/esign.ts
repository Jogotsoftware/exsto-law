// E-signature API surface (Session 5). All paths flow through the operation
// core (submitAction). NATIVE-FIRST: signing happens in the substrate via a
// sign-by-link flow — no external host, no recurring cost. The provider-agnostic
// EsignDriver seam is retained for a future external provider, but 'native' is
// the default and is handled directly here.
//
// Send (sendForSignature):
//   resolve doc + signers → create the envelope (esign.send) → for native, mint
//   a per-signer signing token and email each signer their secure link. For an
//   external provider, dispatch via its driver behind the WP5.3 connection gate.
//
// Sign (recordSignature / declineSignature): the public sign page verifies a
//   signing token and records the signature (esign.sign) or decline
//   (esign.decline) as the public-intake system actor — signer identity lives on
//   the signature_request, like the client portal.
//
// External callback (handleEsignCallback): dormant; only used if an external
//   driver is configured.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { getDraftVersion } from '../queries/drafts.js'
import { getMatter } from '../queries/matters.js'
import { loadConnection } from '../adapters/connectionStore.js'
import { ingestionContext } from './granolaIngestion.js'
import { queueNotification } from './notifications.js'
import {
  DEFAULT_ESIGN_PROVIDER,
  EsignNotConfiguredError,
  getEsignDriver,
  signSigningToken,
  verifySigningToken,
  type EsignCallbackEvent,
} from '../esign/index.js'

// Public-intake system actor (same as the client portal): signer-facing writes
// run as this actor; the human signer's identity lives on the signature_request.
const SIGNING_ACTOR = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

// Absolute base for signing links (same fallback as the client-auth routes —
// Netlify rewrites request.url, so a hardcoded fallback is the reliable source).
function signBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.URL ??
    'https://exstolaw.netlify.app'
  ).replace(/\/$/, '')
}

function signingCtx(tenantId: string): ActionContext {
  return { tenantId, actorId: SIGNING_ACTOR }
}

export interface SendForSignatureInput {
  documentVersionId: string
  /** Override signers; defaults to the matter's client contact. */
  signers?: Array<{ email: string; name?: string }>
  subject?: string
  /** Override the provider; defaults to DEFAULT_ESIGN_PROVIDER ('native'). */
  provider?: string
}

export interface SendForSignatureResult {
  envelopeId: string
  dispatched: boolean
  provider: string
  providerEnvelopeRef: string | null
  signerCount: number
  /** Present when an external provider is selected but not yet connected. */
  activation?: string
  signerLinks?: Array<{ email: string; url: string }>
}

export async function sendForSignature(
  ctx: ActionContext,
  input: SendForSignatureInput,
): Promise<SendForSignatureResult> {
  const draft = await getDraftVersion(ctx, input.documentVersionId)
  if (!draft) throw new Error(`Document version not found: ${input.documentVersionId}`)

  let signers = input.signers?.filter((s) => s.email?.trim())
  if (!signers || signers.length === 0) {
    const matter = draft.matterEntityId ? await getMatter(ctx, draft.matterEntityId) : null
    const email = matter?.clientEmail?.trim()
    if (!email) {
      throw new Error(
        'No signer specified and no client email on file for the matter. ' +
          'Pass `signers`, or add an email to the matter contact.',
      )
    }
    signers = [{ email, name: matter?.clientName || undefined }]
  }

  const provider = input.provider ?? DEFAULT_ESIGN_PROVIDER
  const subject =
    input.subject ??
    `Signature requested: ${draft.documentKind.replace(/_/g, ' ')} — ${draft.matterNumber}`
  const correlationId = randomUUID()

  let dispatched = false
  let providerEnvelopeRef: string | null = null
  let signerLinks: Array<{ email: string; url: string }> | undefined
  let activation: string | undefined

  if (provider === 'native') {
    // Native always dispatches (it emails signing links — no external host).
    dispatched = true
  } else {
    // External driver behind the connection gate (WP5.3): only call a provider
    // when its host is connected; 'stub' needs none.
    const driver = getEsignDriver(provider)
    const connected =
      provider === 'stub' ? true : Boolean(await loadConnection(ctx.tenantId, provider))
    if (connected) {
      try {
        const dispatch = await driver.sendEnvelope(ctx.tenantId, {
          subject,
          document: {
            contentType: 'text/markdown',
            body: draft.bodyMarkdown,
            filename: `${draft.documentKind}.md`,
          },
          signers,
          correlationId,
        })
        dispatched = true
        providerEnvelopeRef = dispatch.providerEnvelopeRef
        signerLinks = dispatch.signerLinks
      } catch (err) {
        if (err instanceof EsignNotConfiguredError) activation = err.message
        else throw err
      }
    } else {
      activation =
        `'${provider}' is not connected — the envelope is recorded as pending_dispatch and was ` +
        `NOT sent. Connect the provider in Settings → Integrations to activate.`
    }
  }

  const result = await submitAction(ctx, {
    actionKindName: 'esign.send',
    intentKind: 'enforcement',
    payload: {
      document_entity_id: draft.documentEntityId,
      document_version_id: draft.documentVersionId,
      matter_entity_id: draft.matterEntityId ?? null,
      provider,
      provider_envelope_ref: providerEnvelopeRef,
      dispatched,
      correlation_id: correlationId,
      subject,
      signers: signers.map((s) => ({ email: s.email, name: s.name ?? null })),
    },
  })
  const eff = (result.effects[0] ?? {}) as { envelopeId?: string; requestIds?: string[] }
  const envelopeId = eff.envelopeId ?? ''

  // Native dispatch: mint a signing token per request and email the secure link.
  if (provider === 'native' && envelopeId && eff.requestIds) {
    signerLinks = []
    for (let i = 0; i < signers.length; i++) {
      const requestId = eff.requestIds[i]
      if (!requestId) continue
      const token = signSigningToken({ requestId, envelopeId, tenantId: ctx.tenantId })
      const url = `${signBaseUrl()}/sign/${encodeURIComponent(token)}`
      signerLinks.push({ email: signers[i]!.email, url })
      await queueNotification(ctx, {
        routeKindName: 'esign_sign_request',
        to: signers[i]!.email,
        variables: {
          signer_name: signers[i]!.name ?? signers[i]!.email,
          sign_url: url,
          document_title: subject,
        },
      })
    }
  }

  return {
    envelopeId,
    dispatched,
    provider,
    providerEnvelopeRef,
    signerCount: signers.length,
    activation,
    signerLinks,
  }
}

// ── Signer-facing (native): the public sign page calls these with the token. ──

export interface SignableDocument {
  documentTitle: string
  bodyMarkdown: string
  signerName: string | null
  signerEmail: string | null
  envelopeStatus: string | null
  signerStatus: string | null
  /** True when this signer already signed/declined, or the envelope is closed. */
  alreadyResolved: boolean
}

export async function loadSignableDocument(token: string): Promise<SignableDocument> {
  const tok = verifySigningToken(token)
  const ctx = signingCtx(tok.tenantId)
  return withActionContext(ctx, async (client) => {
    const signer = await latestAttrs(client, ctx.tenantId, tok.requestId, [
      'signer_name',
      'signer_email',
      'signer_status',
    ])
    const env = await latestAttrs(client, ctx.tenantId, tok.envelopeId, [
      'envelope_subject',
      'envelope_status',
    ])
    const docRes = await client.query<{ body: string }>(
      `SELECT cb.body
         FROM relationship r
         JOIN relationship_kind_definition rkd
           ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'envelope_of'
         JOIN document_version dv
           ON dv.document_entity_id = r.target_entity_id AND dv.tenant_id = r.tenant_id
           AND (dv.metadata->>'executed') IS DISTINCT FROM 'true'
         JOIN content_blob cb ON cb.id = dv.content_blob_id
        WHERE r.tenant_id = $1 AND r.source_entity_id = $2
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY dv.version_number DESC
        LIMIT 1`,
      [ctx.tenantId, tok.envelopeId],
    )
    const signerStatus = signer.signer_status ?? 'pending'
    const envelopeStatus = env.envelope_status ?? null
    return {
      documentTitle: env.envelope_subject ?? 'Document for signature',
      bodyMarkdown: docRes.rows[0]?.body ?? '',
      signerName: signer.signer_name ?? null,
      signerEmail: signer.signer_email ?? null,
      envelopeStatus,
      signerStatus,
      alreadyResolved:
        signerStatus === 'signed' ||
        signerStatus === 'declined' ||
        envelopeStatus === 'completed' ||
        envelopeStatus === 'declined',
    }
  })
}

export interface RecordSignatureInput {
  token: string
  signatureName: string
  signatureData?: string | null
  consent: string
}
export interface RecordSignatureResult {
  ok: boolean
  completed: boolean
  envelopeId: string
  executedDocumentVersionId?: string | null
}

export async function recordSignature(input: RecordSignatureInput): Promise<RecordSignatureResult> {
  const tok = verifySigningToken(input.token)
  if (!input.signatureName?.trim()) throw new Error('A signature (typed name) is required.')
  if (!input.consent?.trim()) throw new Error('Consent to sign electronically is required.')
  const ctx = signingCtx(tok.tenantId)
  const result = await submitAction(ctx, {
    actionKindName: 'esign.sign',
    intentKind: 'enforcement',
    payload: {
      request_entity_id: tok.requestId,
      envelope_entity_id: tok.envelopeId,
      signature_name: input.signatureName.trim(),
      signature_data: input.signatureData ?? null,
      consent_text: input.consent.trim(),
    },
  })
  const eff = (result.effects[0] ?? {}) as {
    completed?: boolean
    executedDocumentVersionId?: string | null
  }
  return {
    ok: true,
    completed: Boolean(eff.completed),
    envelopeId: tok.envelopeId,
    executedDocumentVersionId: eff.executedDocumentVersionId ?? null,
  }
}

export async function declineSignature(input: {
  token: string
  reason?: string
}): Promise<{ ok: boolean; envelopeId: string }> {
  const tok = verifySigningToken(input.token)
  const ctx = signingCtx(tok.tenantId)
  await submitAction(ctx, {
    actionKindName: 'esign.decline',
    intentKind: 'adjustment',
    payload: {
      request_entity_id: tok.requestId,
      envelope_entity_id: tok.envelopeId,
      reason: input.reason ?? null,
    },
  })
  return { ok: true, envelopeId: tok.envelopeId }
}

// Latest value (by valid_from) for a set of attribute kinds on one entity.
async function latestAttrs(
  client: DbClient,
  tenantId: string,
  entityId: string,
  kinds: string[],
): Promise<Record<string, string | null>> {
  const res = await client.query<{ kind_name: string; value: string }>(
    `SELECT DISTINCT ON (akd.kind_name) akd.kind_name, a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = ANY($3)
      ORDER BY akd.kind_name, a.valid_from DESC`,
    [tenantId, entityId, kinds],
  )
  const out: Record<string, string | null> = {}
  for (const row of res.rows) out[row.kind_name] = row.value
  return out
}

// ── External provider callback (dormant) ─────────────────────────────────────

export interface EsignWebhookResult {
  ok: boolean
  status: number
  error?: string
  envelopeId?: string
  recordedStatus?: string
}

// Thin callback entry for EXTERNAL providers only: verify+normalize (driver) →
// raw_event_log → transition. Native signing does not use this path.
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
    if (err instanceof EsignNotConfiguredError) {
      return { ok: false, status: 503, error: err.message }
    }
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
  if (!envelopeId) {
    return { ok: true, status: 202, error: 'no matching envelope (raw payload stored)' }
  }

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

// Map an external callback back to our envelope: by provider ref, then correlation id.
async function resolveEnvelope(
  ctx: ActionContext,
  providerRef: string | null,
  correlationId: string | null | undefined,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    if (providerRef) {
      const byRef = await client.query<{ entity_id: string }>(
        `SELECT a.entity_id
           FROM attribute a
           JOIN attribute_kind_definition akd
             ON akd.id = a.attribute_kind_id AND akd.kind_name = 'provider_envelope_ref'
          WHERE a.tenant_id = $1 AND a.value #>> '{}' = $2
            AND (a.valid_to IS NULL OR a.valid_to > now())
          ORDER BY a.valid_from DESC
          LIMIT 1`,
        [ctx.tenantId, providerRef],
      )
      if (byRef.rows[0]) return byRef.rows[0].entity_id
    }
    if (correlationId) {
      const byCorr = await client.query<{ id: string }>(
        `SELECT e.id
           FROM entity e
           JOIN entity_kind_definition ekd
             ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'signature_envelope'
          WHERE e.tenant_id = $1 AND e.metadata->>'correlation_id' = $2
          LIMIT 1`,
        [ctx.tenantId, correlationId],
      )
      if (byCorr.rows[0]) return byCorr.rows[0].id
    }
    return null
  })
}
