import { createHmac, timingSafeEqual } from 'node:crypto'

// PORTAL-1 (WP6) — the invoice pay magic link. The invoice email carries
// /portal/pay/<number>?t=<this token>, so a client can pay WITHOUT a portal
// session; a signed-in client reaches the same invoice through the session
// door. Same HMAC pattern as the e-sign signing link (#320) — one token
// discipline, domain-separated ('invoice-pay.') so nothing else replays here.
// It binds the invoice NUMBER + tenant + expiry; possession of the emailed
// link (delivered only to the on-file client address) is the proof.

export interface InvoicePayTokenPayload {
  invoiceNumber: string
  tenantId: string
  /** Epoch ms expiry. */
  exp: number
}

function secret(): string {
  const s = process.env.ESIGN_SIGNING_SECRET ?? process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'ESIGN_SIGNING_SECRET (or OAUTH_STATE_SECRET, ≥16 chars) is required to sign invoice pay links.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  return createHmac('sha256', secret()).update(`invoice-pay.${payloadB64}`).digest('base64url')
}

// 30 days — an invoice sits in an inbox; re-sending the invoice mints a fresh
// link, and the portal session door never expires with it.
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function signInvoicePayToken(
  payload: Omit<InvoicePayTokenPayload, 'exp'>,
  ttlMs: number = DEFAULT_TTL_MS,
  nowMs: number = Date.now(),
): string {
  const full: InvoicePayTokenPayload = { ...payload, exp: nowMs + ttlMs }
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

export function verifyInvoicePayToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): InvoicePayTokenPayload {
  if (!token) throw new Error('This payment link is invalid.')
  const dot = token.indexOf('.')
  if (dot <= 0) throw new Error('This payment link is invalid.')
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('This payment link is invalid.')
  }
  let payload: InvoicePayTokenPayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    throw new Error('This payment link is invalid.')
  }
  if (
    typeof payload.invoiceNumber !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('This payment link is invalid.')
  }
  if (payload.exp <= nowMs) {
    throw new Error(
      'This payment link has expired — sign in to your portal to pay, or ask the firm to re-send the invoice.',
    )
  }
  return payload
}
