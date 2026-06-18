// OpenSign driver — the FIRST implementation of EsignDriver (WP5.1).
//
// OpenSign (opensignlabs/opensign, AGPL-3.0) is a self-hosted Parse/Mongo
// service. We integrate over its REST API as an external dependency; no
// OpenSign source is vendored here (anti-pattern §6). Credentials live in
// Supabase Vault behind the 'opensign' connection (Contract A / connectionStore)
// — never a column, never a log (REQ-SEC-01).
//
// Everything here is wired to the point a LIVE host is required: each method
// builds the real request and reads creds from the connection. With no
// connection it raises EsignNotConfiguredError — the single activation gate
// (WP5.3). The endpoint paths follow OpenSign's documented REST API and are
// confirmed against the firm's instance at activation; they are isolated to
// this file so swapping a provider never touches a caller.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { loadConnection } from '../../adapters/connectionStore.js'
import {
  EsignNotConfiguredError,
  type EsignCallbackEvent,
  type EsignDriver,
  type EsignStatus,
  type EnvelopeStatusReport,
  type SendEnvelopeInput,
  type SendEnvelopeResult,
  type SignerStatus,
} from '../types.js'

// The Vault-stored secret shape for the 'opensign' connection.
interface OpenSignSecret {
  base_url: string // self-hosted OpenSign root, e.g. https://sign.pacheco.law
  api_token: string // OpenSign x-api-token
  webhook_secret?: string // HMAC secret for inbound callback verification
}

const ACTIVATION_HINT =
  'OpenSign is not connected. Stand up a self-hosted OpenSign instance and connect it in ' +
  'Settings → Integrations as provider "opensign" (base_url + api_token + webhook_secret). ' +
  'See verticals/legal/docs/ESIGN_ACTIVATION.md.'

async function requireCreds(tenantId: string): Promise<OpenSignSecret> {
  const conn = await loadConnection<OpenSignSecret>(tenantId, 'opensign')
  if (!conn?.secret?.base_url || !conn.secret.api_token) {
    throw new EsignNotConfiguredError(ACTIVATION_HINT)
  }
  return conn.secret
}

function root(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return '(no body)'
  }
}

// OpenSign status strings → our canonical lifecycle. Kept liberal: OpenSign has
// used both "signed"/"completed" and event-style names across versions.
function toCanonicalStatus(raw: string | undefined): EsignStatus {
  const s = (raw ?? '').toLowerCase()
  if (s.includes('declin') || s.includes('reject')) return 'declined'
  if (s.includes('complet') || s.includes('finish') || s.includes('all_signed')) return 'completed'
  if (s.includes('sign')) return 'signed'
  return 'sent'
}

function toSignerStatus(raw: string | undefined): SignerStatus {
  const s = (raw ?? '').toLowerCase()
  if (s.includes('declin') || s.includes('reject')) return 'declined'
  if (s.includes('sign') || s.includes('complet')) return 'signed'
  return 'pending'
}

function verifyHmac(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const given = signature.replace(/^sha256=/, '').trim()
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(given, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export const openSignDriver: EsignDriver = {
  provider: 'opensign',

  async sendEnvelope(tenantId: string, input: SendEnvelopeInput): Promise<SendEnvelopeResult> {
    const { base_url, api_token } = await requireCreds(tenantId)
    const res = await fetch(`${root(base_url)}/api/v1/createdocument`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-token': api_token },
      body: JSON.stringify({
        title: input.subject,
        file: `data:${input.document.contentType};base64,${Buffer.from(
          input.document.body,
          'utf8',
        ).toString('base64')}`,
        signers: input.signers.map((s, i) => ({
          name: s.name ?? s.email,
          email: s.email,
          order: s.order ?? i + 1,
        })),
        send_email: true,
        // Round-trip our correlation id so the webhook maps back to our envelope.
        meta: { correlation_id: input.correlationId },
      }),
    })
    if (!res.ok) {
      throw new Error(`OpenSign createdocument failed: ${res.status} ${await bodyText(res)}`)
    }
    const out = (await res.json()) as {
      objectId?: string
      id?: string
      signers?: Array<{ email?: string; signUrl?: string; url?: string }>
    }
    const providerEnvelopeRef = out.objectId ?? out.id
    if (!providerEnvelopeRef) throw new Error('OpenSign createdocument returned no document id')
    const signerLinks = (out.signers ?? [])
      .filter((s) => s.email && (s.signUrl ?? s.url))
      .map((s) => ({ email: s.email!, url: (s.signUrl ?? s.url)! }))
    return { providerEnvelopeRef, signerLinks: signerLinks.length ? signerLinks : undefined }
  },

  async getEnvelopeStatus(
    tenantId: string,
    providerEnvelopeRef: string,
  ): Promise<EnvelopeStatusReport> {
    const { base_url, api_token } = await requireCreds(tenantId)
    const res = await fetch(
      `${root(base_url)}/api/v1/document/${encodeURIComponent(providerEnvelopeRef)}`,
      { headers: { 'x-api-token': api_token } },
    )
    if (!res.ok) {
      throw new Error(`OpenSign get document failed: ${res.status} ${await bodyText(res)}`)
    }
    const out = (await res.json()) as {
      status?: string
      signers?: Array<{ email?: string; status?: string }>
      signedFileUrl?: string
    }
    return {
      providerEnvelopeRef,
      status: toCanonicalStatus(out.status),
      signers: (out.signers ?? [])
        .filter((s) => s.email)
        .map((s) => ({ email: s.email!, status: toSignerStatus(s.status) })),
      // The executed copy is fetched lazily (signedFileUrl) by the caller when
      // needed; status polling does not inline the bytes.
      executedDocument: null,
    }
  },

  async parseCallback(args: {
    tenantId: string
    rawBody: string
    signature: string | null
  }): Promise<EsignCallbackEvent> {
    const { webhook_secret } = await requireCreds(args.tenantId)
    // A configured secret is verified; OpenSign instances that cannot HMAC-sign
    // must be fronted by a shared-secret header the route maps to `signature`.
    if (webhook_secret && !verifyHmac(args.rawBody, args.signature, webhook_secret)) {
      throw new Error('OpenSign webhook signature verification failed')
    }
    const payload = JSON.parse(args.rawBody) as Record<string, unknown>
    const objectId =
      (payload.objectId as string | undefined) ??
      (payload.documentId as string | undefined) ??
      (payload.id as string | undefined) ??
      null
    const meta = (payload.meta as Record<string, unknown> | undefined) ?? {}
    const status = toCanonicalStatus(
      (payload.event as string | undefined) ?? (payload.status as string | undefined),
    )
    const executedBase64 =
      (payload.signedFileBase64 as string | undefined) ??
      (payload.base64 as string | undefined) ??
      null
    return {
      providerEnvelopeRef: objectId,
      correlationId: (meta.correlation_id as string | undefined) ?? null,
      status,
      signerEmail: (payload.signerEmail as string | undefined) ?? null,
      executedDocument:
        status === 'completed' && executedBase64
          ? {
              contentType: 'application/pdf',
              body: Buffer.from(executedBase64, 'base64').toString('utf8'),
            }
          : null,
      raw: payload,
    }
  },
}
