// AUTH-HANDOFF-1 — the ONE cross-host sign-in bridge. Sessions are host-only
// cookies, so authentication that completes on the canonical host (the single
// Google OAuth redirect URI; the marketing site's neutral /signin) cannot set
// the firm subdomain's cookie. Instead the canonical host mints a short-lived,
// single-use, HMAC-signed handoff token naming exactly one principal and one
// firm host; GET /api/auth/handoff on that firm host verifies it, burns its jti
// in the DB (replays die across serverless instances — migration 0198), checks
// the token's slug against the host it actually arrived on, and only then mints
// the normal session cookie there.
//
// Containment properties, in order of importance:
//   • single-use: DB burn, not memory — a leaked Location URL is dead after one use
//   • 60s TTL: the token lives exactly as long as one redirect hop needs
//   • host-bound: exchanged ONLY on the firm host it names (x-firm-host headers,
//     which middleware alone can set) — firm B can never redeem firm A's token
//   • domain-separated MAC ('handoff' prefix): a session/state MAC over the same
//     bytes can't be replayed as a handoff, or vice versa
//   • dest is a safeInternalPath at mint AND exchange — the token never encodes
//     a cross-origin redirect, only a path on the destination host

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { firmOriginFromSlug } from '@exsto/legal'
import { validatePublicSlug } from '@exsto/legal/slug'
import { safeInternalPath } from '@/lib/safeRedirect'

const DOMAIN_PREFIX = 'handoff.v1:'
const HANDOFF_TTL_SECONDS = 60

function secret(): string {
  const s = process.env.AUTH_HANDOFF_SECRET ?? process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'AUTH_HANDOFF_SECRET (or OAUTH_STATE_SECRET) is required (≥16 chars) to sign auth handoffs.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  return createHmac('sha256', secret()).update(DOMAIN_PREFIX).update(payloadB64).digest('base64url')
}

export interface AttorneyHandoff {
  kind: 'attorney'
  tenantId: string
  actorId: string
  email: string
  displayName: string
}

export interface ClientHandoff {
  kind: 'client'
  tenantId: string
  clientContactId: string
}

export type HandoffPrincipal = AttorneyHandoff | ClientHandoff

interface HandoffPayload {
  p: HandoffPrincipal
  slug: string
  dest: string
  jti: string
  iat: number
  exp: number
}

export function mintHandoffToken(principal: HandoffPrincipal, slug: string, dest: string): string {
  const v = validatePublicSlug(slug)
  if (!v.ok) throw new Error(`handoff slug invalid: ${v.error}`)
  const iat = Math.floor(Date.now() / 1000)
  const payload: HandoffPayload = {
    p: principal,
    slug: v.slug,
    dest: safeInternalPath(dest, '/'),
    jti: randomUUID(),
    iat,
    exp: iat + HANDOFF_TTL_SECONDS,
  }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${b64}.${mac(b64)}`
}

export interface VerifiedHandoff {
  principal: HandoffPrincipal
  slug: string
  dest: string
  jti: string
}

// MAC + expiry verification only — the caller must additionally (a) burn the jti
// via private.burn_handoff_jti and treat false as replay, and (b) require the
// exchanging request's firm host to equal `slug`. Returns null on any defect.
export function verifyHandoffToken(token: string | null | undefined): VerifiedHandoff | null {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const b64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(b64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: HandoffPayload
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as HandoffPayload
  } catch {
    return null
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
  if (typeof payload.jti !== 'string' || !payload.jti) return null
  if (typeof payload.slug !== 'string' || !validatePublicSlug(payload.slug).ok) return null
  if (payload.p?.kind !== 'attorney' && payload.p?.kind !== 'client') return null
  return {
    principal: payload.p,
    slug: payload.slug,
    dest: safeInternalPath(payload.dest, '/'),
    jti: payload.jti,
  }
}

// The absolute URL the canonical host 302s to: the firm host's exchange
// endpoint. The origin comes from the DB-validated slug, never user input.
export function handoffRedirectUrl(slug: string, token: string): string {
  return `${firmOriginFromSlug(slug)}/api/auth/handoff?token=${encodeURIComponent(token)}`
}
