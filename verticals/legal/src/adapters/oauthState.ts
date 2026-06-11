import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-signed OAuth state. The state round-trips through the user's browser and
// carries tenantId + returnTo, so an UNSIGNED state is attacker-controllable:
// today (single-tenant) the only live consequence was the returnTo open-redirect
// (now also path-validated), but the moment this clone goes multi-tenant a
// forged tenantId becomes a connect-to-victim hijack. Signing makes the whole
// payload tamper-proof: a client that mutates any field invalidates the MAC.
//
// Fail-closed: OAUTH_STATE_SECRET is REQUIRED. No secret ⇒ the OAuth flow refuses
// to start or complete rather than falling back to an unsigned state.

function secret(): string {
  const s = process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'OAUTH_STATE_SECRET is required (≥16 chars) to sign OAuth state. ' +
        'Set it in .env.local / the deploy env.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url')
}

// Returns `<base64url(json)>.<base64url(hmac)>`.
export function signOAuthState(payload: Record<string, unknown>): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

// Verifies the MAC (constant-time) and returns the parsed payload, or throws.
export function verifyOAuthState<T = Record<string, unknown>>(state: string): T {
  const dot = state.indexOf('.')
  if (dot <= 0) throw new Error('Invalid OAuth state.')
  const payloadB64 = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = mac(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('OAuth state signature mismatch — refusing to proceed.')
  }
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as T
  } catch {
    throw new Error('Invalid OAuth state.')
  }
}
