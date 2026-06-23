// Server-only: platform admin-console session (ADR 0046). A SEPARATE boundary from
// the attorney session (lib/session.ts): a distinct httpOnly cookie, a distinct
// domain-separated MAC prefix, and a shorter TTL. Domain separation means an
// attorney session token can NEVER be replayed as an admin token (or vice-versa)
// even though both MACs use the same OAUTH_STATE_SECRET — the prefixes differ.
//
// Fail-closed: OAUTH_STATE_SECRET is REQUIRED; no secret ⇒ signing/verification
// throw rather than degrading to a forgeable token.
import { createHmac, timingSafeEqual } from 'node:crypto'

const DOMAIN_PREFIX = 'admin.session.v1:'
export const ADMIN_SESSION_COOKIE_NAME = 'exsto_admin_session'
// 1 hour — admin sessions are short-lived (a higher-privilege boundary).
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60

export interface AdminSessionPayload {
  actorId: string
  tenantId: string // the platform tenant
  email: string
  displayName: string
  iat: number
  exp: number
}

function secret(): string {
  const s = process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'OAUTH_STATE_SECRET is required (≥16 chars) to sign admin sessions. ' +
        'Set it in .env.local / the deploy env.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  return createHmac('sha256', secret()).update(DOMAIN_PREFIX).update(payloadB64).digest('base64url')
}

export function signAdminSession(
  identity: Pick<AdminSessionPayload, 'actorId' | 'tenantId' | 'email' | 'displayName'>,
  ttlSeconds: number = ADMIN_SESSION_TTL_SECONDS,
): string {
  const iat = Math.floor(Date.now() / 1000)
  const payload: AdminSessionPayload = { ...identity, iat, exp: iat + ttlSeconds }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

export function verifyAdminSession(token: string | null | undefined): AdminSessionPayload | null {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(payloadB64) // throws if secret missing — fail-closed
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: AdminSessionPayload
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as AdminSessionPayload
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
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null
  return payload
}

export function readAdminSessionFromCookieHeader(
  cookieHeader: string | null,
): AdminSessionPayload | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name !== ADMIN_SESSION_COOKIE_NAME) continue
    return verifyAdminSession(decodeURIComponent(part.slice(eq + 1).trim()))
  }
  return null
}

export function buildAdminSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return (
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` +
    `; HttpOnly; Path=/; SameSite=Lax; Max-Age=${ADMIN_SESSION_TTL_SECONDS}${secure}`
  )
}

export function buildClearedAdminSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${ADMIN_SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
}
