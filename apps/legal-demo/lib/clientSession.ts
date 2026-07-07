// Server-only: this module imports node:crypto and reads the server secret. It
// must never be bundled into client code. We don't use the `server-only` import
// guard because the test suite imports this file directly under Node (vitest),
// where that guard throws; instead, the node:crypto dependency makes any
// accidental client import fail loudly at build time, and no client module
// imports this file (the client talks to /api/client/auth/me instead).
import { createHmac, timingSafeEqual } from 'node:crypto'

// Server-verified CLIENT-PORTAL session. This is the client-facing twin of
// lib/session.ts (the attorney session): a signed payload in an httpOnly cookie
// the browser cannot read or forge, so the server is the only party that can
// mint or validate it. It is DELIBERATELY a distinct surface from the attorney
// session — distinct cookie name AND distinct MAC domain prefix — so the two
// can never be confused for each other even though both reuse the same secret.
//
// Domain separation (security-critical): every MAC here is computed over a
// 'client-session.v1:' prefix. The attorney session uses 'session.v1:' and
// OAuth-state uses no prefix. Because the prefix is part of the signed bytes, an
// attorney session token and an OAuth-state token are both REJECTED by
// verifyClientSession (and vice-versa) even though the underlying HMAC key is
// identical. See ADR 0035.
//
// Fail-closed: OAUTH_STATE_SECRET is REQUIRED (mirrors lib/session.ts and
// adapters/oauthState.ts). No secret ⇒ signing and verification throw rather
// than degrading to an unsigned/forgeable token.

const SESSION_DOMAIN_PREFIX = 'client-session.v1:'

export const CLIENT_SESSION_COOKIE_NAME = 'exsto_client_session'

// 8 hours, in seconds. Used for both the `exp` claim and the cookie Max-Age so
// they expire together.
export const CLIENT_SESSION_TTL_SECONDS = 8 * 60 * 60

export interface ClientSessionPayload {
  clientContactId: string
  tenantId: string
  // The set of matter ids this client is client_of, captured at consume time.
  // Authorization in the authed route is checked against THIS list — never
  // against anything in the request body.
  matterIds: string[]
  email: string
  displayName: string
  iat: number // issued-at, unix seconds
  exp: number // expiry, unix seconds
}

function secret(): string {
  const s = process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'OAUTH_STATE_SECRET is required (≥16 chars) to sign client-portal sessions. ' +
        'Set it in .env.local / the deploy env.',
    )
  }
  return s
}

// Domain-separated MAC. The prefix is the only thing that distinguishes a
// client-session MAC from an attorney-session MAC or an OAuth-state MAC over the
// same bytes — so none can be replayed as another.
function mac(domainPrefix: string, payloadB64: string): string {
  return createHmac('sha256', secret()).update(domainPrefix).update(payloadB64).digest('base64url')
}

// Generic verify: checks the MAC (constant-time) and the `exp` claim, returning
// the parsed payload or null. Never throws EXCEPT when the secret is missing
// (fail-closed). Callers narrow the payload shape afterwards.
function verifyToken(
  domainPrefix: string,
  token: string | null | undefined,
): Record<string, unknown> | null {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(domainPrefix, payloadB64) // throws if secret missing — fail-closed
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.exp !== 'number') return null
  const now = Math.floor(Date.now() / 1000)
  if ((payload.exp as number) <= now) return null // expired
  return payload
}

// ───────────────────────────────────────────────────────────────────────────
// Client SESSION (the long-lived authed cookie).
// ───────────────────────────────────────────────────────────────────────────

// Mint a signed client session. `iat`/`exp` are filled in here so callers only
// supply identity + the authorized matter set. Returns
// `<base64url(json)>.<base64url(hmac)>`.
export function signClientSession(
  identity: Pick<
    ClientSessionPayload,
    'clientContactId' | 'tenantId' | 'matterIds' | 'email' | 'displayName'
  >,
  ttlSeconds: number = CLIENT_SESSION_TTL_SECONDS,
): string {
  const iat = Math.floor(Date.now() / 1000)
  const payload: ClientSessionPayload = {
    clientContactId: identity.clientContactId,
    tenantId: identity.tenantId,
    matterIds: identity.matterIds,
    email: identity.email,
    displayName: identity.displayName,
    iat,
    exp: iat + ttlSeconds,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${mac(SESSION_DOMAIN_PREFIX, payloadB64)}`
}

// Verify the MAC + `exp` and validate the payload shape. Returns the payload or
// null (never throws except on missing secret — fail-closed). An attorney
// session token fails here: wrong domain prefix.
export function verifyClientSession(token: string | null | undefined): ClientSessionPayload | null {
  const payload = verifyToken(SESSION_DOMAIN_PREFIX, token)
  if (!payload) return null
  if (
    typeof payload.clientContactId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    !Array.isArray(payload.matterIds) ||
    !payload.matterIds.every((m) => typeof m === 'string') ||
    typeof payload.email !== 'string' ||
    typeof payload.displayName !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    return null
  }
  return payload as unknown as ClientSessionPayload
}

// Read + verify the client session from a raw Cookie header. Parses a minimal,
// well-formed cookie list — no external dependency. Ignores every cookie but
// our own name, so the attorney's exsto_session cookie is never even considered.
export function readClientSessionFromCookieHeader(
  cookieHeader: string | null,
): ClientSessionPayload | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name !== CLIENT_SESSION_COOKIE_NAME) continue
    const value = part.slice(eq + 1).trim()
    return verifyClientSession(decodeURIComponent(value))
  }
  return null
}

// Build the Set-Cookie value for a freshly-issued client session. httpOnly so
// JS can never read it; Secure in production; SameSite=Lax so it rides the
// top-level magic-link navigation but not cross-site sub-requests.
export function buildClientSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return (
    `${CLIENT_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` +
    `; HttpOnly; Path=/; SameSite=Lax; Max-Age=${CLIENT_SESSION_TTL_SECONDS}${secure}`
  )
}

// Build the Set-Cookie value that clears the client session (Max-Age=0).
export function buildClearedClientSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${CLIENT_SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
}
