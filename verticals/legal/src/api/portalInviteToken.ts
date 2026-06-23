import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-signed "set up your portal access" token. Minted by the attorney's
// `legal.contact.invite_to_portal` tool and emailed to a client_contact's
// on-file address; round-tripped through their browser to the PUBLIC
// /portal/set-password page where they choose a password. Possession of the
// link — delivered only to the inbox the firm has on file — is the proof of
// email control, the SAME model as the e-sign signing link, the booking-manage
// link, and the client-portal magic link.
//
// It carries the client_contact id, the tenant id, and an expiry; mutating any
// field invalidates the MAC. The tenant is resolved from the SIGNED payload,
// never from the request (hard rule 9, exsto-public-surface §1). The set-password
// route binds this proven identity to a Supabase Auth password and mints the same
// httpOnly portal session the magic-link flow does.
//
// Fail-closed: a secret is REQUIRED. Reuses ESIGN_SIGNING_SECRET, falling back to
// OAUTH_STATE_SECRET (already required in every deploy) so no new env is needed.

export interface PortalInviteTokenPayload {
  clientContactId: string
  tenantId: string
  /** Epoch ms expiry. */
  exp: number
}

function secret(): string {
  const s = process.env.ESIGN_SIGNING_SECRET ?? process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'ESIGN_SIGNING_SECRET (or OAUTH_STATE_SECRET, ≥16 chars) is required to sign portal-invite links. ' +
        'Set it in .env.local / the deploy env.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  // Domain-separated ('client-portal-invite.') from the booking-manage and e-sign
  // tokens so a token minted for one purpose can never be replayed against another,
  // even on a shared secret.
  return createHmac('sha256', secret())
    .update(`client-portal-invite.${payloadB64}`)
    .digest('base64url')
}

// Default invite lifetime: 7 days. Long enough that a client can act on the email
// at their leisure; short enough that a leaked link is low-value. Re-inviting mints
// a fresh token (and resets the password), so an expired invite is never a dead end.
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function signPortalInviteToken(
  payload: Omit<PortalInviteTokenPayload, 'exp'>,
  ttlMs: number = DEFAULT_TTL_MS,
  nowMs: number = Date.now(),
): string {
  const full: PortalInviteTokenPayload = { ...payload, exp: nowMs + ttlMs }
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

// Verify the MAC (constant-time) AND the expiry; returns the payload or throws.
export function verifyPortalInviteToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): PortalInviteTokenPayload {
  if (!token) throw new Error('Missing invite link.')
  const dot = token.indexOf('.')
  if (dot <= 0) throw new Error('This invite link is invalid.')
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('This invite link is invalid.')
  }
  let payload: PortalInviteTokenPayload
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as PortalInviteTokenPayload
  } catch {
    throw new Error('This invite link is invalid.')
  }
  if (
    typeof payload.clientContactId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('This invite link is invalid.')
  }
  if (payload.exp < nowMs) {
    throw new Error('This invite link has expired. Ask the firm to send a new one.')
  }
  return payload
}
