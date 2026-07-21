import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-signed signing-link token (native e-sign). The token is emailed to a
// signer and round-trips through their browser to the public sign page, so it
// MUST be tamper-proof and bound to the email it was sent to: it carries the
// signature_request id, envelope id, tenant id, and an expiry. A signer who
// mutates any field invalidates the MAC. Possession of the link (delivered only
// to the signer's inbox) is the email-binding — the same model as the client-
// portal magic link.
//
// COMPACT FORMAT (minted since the delivery fix): a fixed 72-byte binary blob
// (version ‖ tenant ‖ envelope ‖ request ‖ exp ‖ scope ‖ 16-byte HMAC tag),
// base64url — 96 chars, no dots. The original JSON format produced ~300-char
// links, and Gmail silently hard-dropped the signing emails carrying them
// (long opaque token + *.netlify.app host + "review and sign" copy is the
// classic phishing fingerprint; every other template from the same sender
// delivered fine). verifySigningToken accepts BOTH formats so links already
// in inboxes keep working: legacy tokens contain a '.', compact tokens never do.
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

// Default signing-link lifetime: 14 days (matters move slowly; longer than a
// portal login, shorter than indefinite).
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000

const COMPACT_VERSION = 0x01
// version(1) + tenant(16) + envelope(16) + request(16) + exp-seconds(6) + scope(1)
const COMPACT_BODY_BYTES = 56
// HMAC-SHA256 truncated to 128 bits — standard truncation, far beyond
// brute-force reach, and it keeps the whole token at exactly 96 chars.
const COMPACT_MAC_BYTES = 16
const COMPACT_TOKEN_CHARS = ((COMPACT_BODY_BYTES + COMPACT_MAC_BYTES) * 4) / 3 // 96

function uuidToBytes(id: string, label: string): Buffer {
  const hex = id.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`Invalid ${label} for signing token.`)
  }
  return Buffer.from(hex, 'hex')
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function compactMac(body: Buffer): Buffer {
  return createHmac('sha256', secret()).update(body).digest().subarray(0, COMPACT_MAC_BYTES)
}

export function signSigningToken(
  payload: Omit<SigningTokenPayload, 'exp'>,
  ttlMs: number = DEFAULT_TTL_MS,
  nowMs: number = Date.now(),
): string {
  const body = Buffer.alloc(COMPACT_BODY_BYTES)
  let o = 0
  body[o] = COMPACT_VERSION
  o += 1
  uuidToBytes(payload.tenantId, 'tenantId').copy(body, o)
  o += 16
  uuidToBytes(payload.envelopeId, 'envelopeId').copy(body, o)
  o += 16
  uuidToBytes(payload.requestId, 'requestId').copy(body, o)
  o += 16
  body.writeUIntBE(Math.floor((nowMs + ttlMs) / 1000), o, 6)
  o += 6
  body[o] = payload.scope === 'view' ? 1 : 0
  return Buffer.concat([body, compactMac(body)]).toString('base64url')
}

// Verify the MAC (constant-time) AND the expiry; returns the payload or throws.
// Accepts both token formats: legacy JSON tokens (contain a '.') and compact.
export function verifySigningToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): SigningTokenPayload {
  if (!token) throw new Error('Missing signing token.')
  if (token.includes('.')) return verifyLegacyToken(token, nowMs)

  if (token.length !== COMPACT_TOKEN_CHARS || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Invalid signing token.')
  }
  const buf = Buffer.from(token, 'base64url')
  if (buf.length !== COMPACT_BODY_BYTES + COMPACT_MAC_BYTES) {
    throw new Error('Invalid signing token.')
  }
  const body = buf.subarray(0, COMPACT_BODY_BYTES)
  const tag = buf.subarray(COMPACT_BODY_BYTES)
  if (!timingSafeEqual(tag, compactMac(body))) {
    throw new Error('Signing token signature mismatch — refusing to proceed.')
  }
  if (body[0] !== COMPACT_VERSION) throw new Error('Invalid signing token.')
  let o = 1
  const tenantId = bytesToUuid(body.subarray(o, o + 16))
  o += 16
  const envelopeId = bytesToUuid(body.subarray(o, o + 16))
  o += 16
  const requestId = bytesToUuid(body.subarray(o, o + 16))
  o += 16
  const exp = body.readUIntBE(o, 6) * 1000
  o += 6
  const scope: 'sign' | 'view' = body[o] === 1 ? 'view' : 'sign'
  if (exp < nowMs) {
    throw new Error('This signing link has expired. Ask the firm to resend it.')
  }
  return { requestId, envelopeId, tenantId, exp, scope }
}

function verifyLegacyToken(token: string, nowMs: number): SigningTokenPayload {
  const dot = token.indexOf('.')
  if (dot <= 0) throw new Error('Invalid signing token.')
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = createHmac('sha256', secret()).update(payloadB64).digest('base64url')
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
