import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-signed "manage your appointment" token. Emailed to a prospect in the
// booking confirmation and round-tripped through their browser to the PUBLIC
// /book/manage/[token] page, so it MUST be tamper-proof and self-describing: it
// carries the matter (booking) id, the tenant id, and an expiry. Mutating any
// field invalidates the MAC. Possession of the link — delivered only to the
// inbox the client booked with — is the authorization, the SAME model as the
// e-sign signing link and the client-portal magic link.
//
// Why a token and not the portal session: the prospect has no account yet at
// booking time. The token lets them reschedule/cancel one specific consultation
// without signing in, while the tenant is resolved from the SIGNED payload
// (never from the request — hard rule 9, exsto-public-surface §1).
//
// Fail-closed: a secret is REQUIRED. Reuses ESIGN_SIGNING_SECRET, falling back to
// OAUTH_STATE_SECRET (already required in every deploy) so no new env is needed.

export interface BookingManageTokenPayload {
  matterEntityId: string
  tenantId: string
  /** Epoch ms expiry. */
  exp: number
}

function secret(): string {
  const s = process.env.ESIGN_SIGNING_SECRET ?? process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'ESIGN_SIGNING_SECRET (or OAUTH_STATE_SECRET, ≥16 chars) is required to sign booking-manage links. ' +
        'Set it in .env.local / the deploy env.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  // Domain-separated from the e-sign token so a token minted for one purpose can
  // never be replayed against the other, even on a shared secret.
  return createHmac('sha256', secret()).update(`booking-manage.${payloadB64}`).digest('base64url')
}

// Default manage-link lifetime: 60 days. Consultations are near-term, but a
// prospect may sit on the email a while before deciding to move or cancel; the
// booking handler still rejects changes to an already-cancelled matter, so an
// over-long token can never resurrect a closed booking.
const DEFAULT_TTL_MS = 60 * 24 * 60 * 60 * 1000

export function signBookingManageToken(
  payload: Omit<BookingManageTokenPayload, 'exp'>,
  ttlMs: number = DEFAULT_TTL_MS,
  nowMs: number = Date.now(),
): string {
  const full: BookingManageTokenPayload = { ...payload, exp: nowMs + ttlMs }
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

// Verify the MAC (constant-time) AND the expiry; returns the payload or throws.
export function verifyBookingManageToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): BookingManageTokenPayload {
  if (!token) throw new Error('Missing appointment link.')
  const dot = token.indexOf('.')
  if (dot <= 0) throw new Error('This appointment link is invalid.')
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('This appointment link is invalid.')
  }
  let payload: BookingManageTokenPayload
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as BookingManageTokenPayload
  } catch {
    throw new Error('This appointment link is invalid.')
  }
  if (
    typeof payload.matterEntityId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('This appointment link is invalid.')
  }
  if (payload.exp < nowMs) {
    throw new Error('This appointment link has expired. Please contact the firm to make a change.')
  }
  return payload
}
