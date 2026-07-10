import { createHmac, timingSafeEqual } from 'node:crypto'

// PORTAL-1 (WP2) — the SHORT-LIVED share token that replaces the durable public
// /d/<versionId> capability URL. A bare document-version UUID used to be enough
// to read a client document body forever; now the public door requires this
// signed token (minted only when the firm emails a share link), and the portal
// door serves the same document behind the client session, scoped to the
// client's own matters. Same HMAC pattern as the e-sign signing link (#320) —
// domain-separated so no other token can be replayed here.

export interface DraftLinkTokenPayload {
  documentVersionId: string
  tenantId: string
  /** Epoch ms expiry. */
  exp: number
}

function secret(): string {
  const s = process.env.ESIGN_SIGNING_SECRET ?? process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'ESIGN_SIGNING_SECRET (or OAUTH_STATE_SECRET, ≥16 chars) is required to sign draft share links.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  return createHmac('sha256', secret()).update(`draft-share.${payloadB64}`).digest('base64url')
}

// 30 days: a client acts on a "your draft is ready" email at their leisure, and
// re-sending mints a fresh token — an expired link is never a dead end. Portal
// access (session door) never expires with the link.
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function signDraftLinkToken(
  payload: Omit<DraftLinkTokenPayload, 'exp'>,
  ttlMs: number = DEFAULT_TTL_MS,
  nowMs: number = Date.now(),
): string {
  const full: DraftLinkTokenPayload = { ...payload, exp: nowMs + ttlMs }
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

export function verifyDraftLinkToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): DraftLinkTokenPayload {
  if (!token) throw new Error('This link is invalid.')
  const dot = token.indexOf('.')
  if (dot <= 0) throw new Error('This link is invalid.')
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('This link is invalid.')
  let payload: DraftLinkTokenPayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    throw new Error('This link is invalid.')
  }
  if (
    typeof payload.documentVersionId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('This link is invalid.')
  }
  if (payload.exp <= nowMs) {
    throw new Error(
      'This link has expired — ask the firm to re-send it, or sign in to your portal.',
    )
  }
  return payload
}
