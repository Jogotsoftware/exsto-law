// Server-only: this module imports node:crypto and reads the server secret. It
// must never be bundled into client code. We don't use the `server-only` import
// guard because the test suite imports this file directly under Node (vitest),
// where that guard throws; instead, the node:crypto dependency makes any
// accidental client import fail loudly at build time, and no client module
// imports this file (the client talks to /api/auth/me instead).
import { createHmac, timingSafeEqual } from 'node:crypto'

// Server-verified attorney session. The signed payload lives in an httpOnly
// cookie the browser cannot read or forge: the server is the only party that
// can mint or validate it. This replaces the old client-readable localStorage
// "session" (ADR 0035) that the UI turned into x-actor-id / x-tenant-id headers
// — those were trivially forgeable, so anyone could act as any actor.
//
// Secret reuse, domain-separated: we reuse OAUTH_STATE_SECRET (already required
// and documented) rather than introducing a new required env var, but every
// session MAC is computed over a "session.v1:" prefix. Because OAuth-state MACs
// have no such prefix, a session token can never be replayed as an OAuth-state
// token (or vice-versa) even though both keys are identical. See ADR 0035.
//
// Fail-closed: OAUTH_STATE_SECRET is REQUIRED (mirrors adapters/oauthState.ts).
// No secret ⇒ signing and verification throw rather than degrading to an
// unsigned/forgeable token.

const DOMAIN_PREFIX = 'session.v1:'
export const SESSION_COOKIE_NAME = 'exsto_session'
// 8 hours, in seconds. Used for both the JWT-style `exp` claim and the cookie
// Max-Age so they expire together.
export const SESSION_TTL_SECONDS = 8 * 60 * 60

export interface SessionPayload {
  actorId: string
  tenantId: string
  email: string
  displayName: string
  iat: number // issued-at, unix seconds
  exp: number // expiry, unix seconds
}

function secret(): string {
  const s = process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'OAUTH_STATE_SECRET is required (≥16 chars) to sign attorney sessions. ' +
        'Set it in .env.local / the deploy env.',
    )
  }
  return s
}

// Domain-separated MAC: the prefix means a session MAC and an OAuth-state MAC
// over the same bytes differ, so neither token can be confused for the other.
function mac(payloadB64: string): string {
  return createHmac('sha256', secret())
    .update(DOMAIN_PREFIX)
    .update(payloadB64)
    .digest('base64url')
}

// Mint a signed session for a resolved actor. `iat`/`exp` are filled in here so
// callers only supply identity. Returns `<base64url(json)>.<base64url(hmac)>`.
export function signSession(
  identity: Pick<SessionPayload, 'actorId' | 'tenantId' | 'email' | 'displayName'>,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const iat = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    actorId: identity.actorId,
    tenantId: identity.tenantId,
    email: identity.email,
    displayName: identity.displayName,
    iat,
    exp: iat + ttlSeconds,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

// Verify the MAC (constant-time) and the `exp` claim, returning the payload or
// null. Returns null (never throws) for tampered / malformed / expired tokens
// so callers can treat "no valid session" uniformly — EXCEPT when the secret is
// missing, which throws (fail-closed: a misconfigured server must not silently
// accept everyone).
export function verifySession(token: string | null | undefined): SessionPayload | null {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(payloadB64) // throws if secret missing — fail-closed
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: SessionPayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload
  } catch {
    return null
  }
  if (
    !payload ||
    typeof payload.actorId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) return null // expired
  return payload
}

// Read + verify the session from a raw Cookie header (route handlers get the
// request's cookies as a single header string). Parses a minimal, well-formed
// cookie list — no external dependency.
export function readSessionFromCookieHeader(cookieHeader: string | null): SessionPayload | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name !== SESSION_COOKIE_NAME) continue
    const value = part.slice(eq + 1).trim()
    return verifySession(decodeURIComponent(value))
  }
  return null
}

// Build the Set-Cookie header value for a freshly-issued session. httpOnly so
// JS can never read it; Secure in production; SameSite=Lax so it rides
// top-level navigations (the OAuth redirect) but not cross-site sub-requests.
export function buildSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return (
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` +
    `; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`
  )
}

// Build the Set-Cookie header value that clears the session (Max-Age=0).
export function buildClearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
}
