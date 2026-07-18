// Firm switcher (referrals-tenancy P1): re-mint the single-tenant portal session
// for another firm the SAME person is a client of.
//
// Auth = the existing portal session cookie (the person already proved control
// of their email at sign-in). The target tenant is honored ONLY when a live
// membership re-scan of the session's email includes it — membership is
// re-proven from the DB on every switch, never trusted from the cookie or the
// body. The mint path re-resolves matterIds and lazily provisions the client's
// per-tenant portal actor, so the new session is per-firm fresh; the session and
// every downstream query stay single-tenant by construction.
import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { findClientContactMembershipsByEmail } from '@exsto/legal'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { mintClientSessionResponse } from '@/lib/clientSessionMint'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`client-auth-switch-firm:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { tenantId?: unknown } | null
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : ''
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing firm.' }, { status: 400 })
  }

  // Live re-proof: the target firm must be one of THIS email's current
  // memberships. A non-member tenantId gets a generic 403 (no oracle); a stale
  // session whose email no longer matches any membership resolves to the same.
  const memberships = await findClientContactMembershipsByEmail(session.email)
  const target = memberships.find((m) => m.tenantId === tenantId)
  if (!target) {
    return NextResponse.json(
      { error: 'This firm is not available for your account.' },
      {
        status: 403,
      },
    )
  }

  return mintClientSessionResponse(target.tenantId, target.clientContactId, {
    redirect: '/portal',
    path: '/portal',
  })
}
