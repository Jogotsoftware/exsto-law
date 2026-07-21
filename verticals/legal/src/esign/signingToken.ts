import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-signed signing-link token (native e-sign). The token is emailed to a
// signer and round-trips through their browser to the public sign page, so it
// MUST be tamper-proof and bound to the email it was sent to: it carries the
// signature_request id, envelope id, tenant id, and an expiry. A signer who
// mutates any field invalidates the MAC. Possession of the link (delivered only
// to the signer's inbox) is the email-binding — the same model as the client-
// portal magic link.
//
// Fail-closed: a secret is REQUIRED. Reuses ESIGN_SIGNING_SECRET, falling back to
// OAUTH_STATE_SECRET (already required in every deploy) so no new env is needed.

export interface SigningTokenPayload {
  requestId: string
  envelopeId: string
  tenantId: string
  /** Epoch ms expiry. */
  exp: number
  /** ESIGN-UNIFY-1 (ES-1, §9.2): 'view' tokens are minted for `needs_to_view`
   *  recipients — the signer surface renders read-only (no adopt/sign controls)
   *  and the public sign/decline endpoints refuse them. Absent on every token
   *  minted before this field existed; callers MUST treat a missing scope as
   *  'sign' (the original, only, behavior) — never assume 'view'. */
  scope?: 'sign' | 'view'
}

function secret(): string {
  const s = process.env.ESIGN_SIGNING_SECRET ?? process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'ESIGN_SIGNING_SECRET (or OAUTH_STATE_SECRET, ≥16 chars) is required to sign e-sign links. ' +
        'Set it in .env.local / the deploy env.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url')
}

// Default signing-link lifetime: 14 days (matters move slowly; longer than a
// portal login, shorter than indefinite).
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000

export function signSigningToken(
  payload: Omit<SigningTokenPayload, 'exp'>,
  ttlMs: number = DEFAULT_TTL_MS,
  nowMs: number = Date.now(),
): string {
  const full: SigningTokenPayload = { ...payload, exp: nowMs + ttlMs }
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

// Verify the MAC (constant-time) AND the expiry; returns the payload or throws.
export function verifySigningToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): SigningTokenPayload {
  if (!token) throw new Error('Missing signing token.')
  const dot = token.indexOf('.')
  if (dot <= 0) throw new Error('Invalid signing token.')
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Signing token signature mismatch — refusing to proceed.')
  }
  let payload: SigningTokenPayload
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as SigningTokenPayload
  } catch {
    throw new Error('Invalid signing token.')
  }
  if (typeof payload.exp !== 'number' || payload.exp < nowMs) {
    throw new Error('This signing link has expired. Ask the firm to resend it.')
  }
  return payload
}
