import { NextResponse } from 'next/server'
import { withAppRole } from '@exsto/shared'
import { verifyHandoffToken } from '@/lib/authHandoff'
import { firmHostFromRequest } from '@/lib/hostTenantGuard'
import { requestOrigin } from '@/lib/requestOrigin'
import { signSession, buildSessionCookie } from '@/lib/session'
import { mintClientSession } from '@/lib/clientSessionMint'
import { appBaseUrl } from '@exsto/legal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AUTH-HANDOFF-1 — the firm-host half of the cross-host sign-in bridge (see
// lib/authHandoff.ts for the token's containment properties). Every check here
// fails CLOSED to the neutral sign-in page: a handoff that can't be proven
// valid, fresh, unused, and addressed to THIS host mints nothing.

function rejected(reason: string): NextResponse {
  return NextResponse.redirect(`${appBaseUrl()}/signin?error=${encodeURIComponent(reason)}`)
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const verified = verifyHandoffToken(url.searchParams.get('token'))
  if (!verified) return rejected('signin_expired')

  // The token is exchanged ONLY on the firm host it names. x-firm-host/x-firm-slug
  // are middleware-set (client values stripped at the edge), so this binds the
  // exchange to the real host the request arrived on.
  const host = firmHostFromRequest(request)
  if (!host || host.slug !== verified.slug) return rejected('wrong_host')

  // Single-use across all serverless instances: the DB burn is authoritative.
  // false = jti already seen ⇒ replay ⇒ dead.
  const fresh = await withAppRole(async (client) => {
    const res = await client.query<{ burn_handoff_jti: boolean }>(
      `SELECT private.burn_handoff_jti($1)`,
      [verified.jti],
    )
    return res.rows[0]?.burn_handoff_jti === true
  })
  if (!fresh) return rejected('signin_expired')

  const dest = verified.dest
  const origin = requestOrigin(request)

  if (verified.principal.kind === 'attorney') {
    const { tenantId, actorId, email, displayName } = verified.principal
    const res = NextResponse.redirect(`${origin}${dest}`)
    res.headers.set(
      'Set-Cookie',
      buildSessionCookie(signSession({ tenantId, actorId, email, displayName })),
    )
    return res
  }

  // Client principal: reuse the vetted mint path — it re-checks the contact is
  // active/unrevoked AND (via the request) that this tenant belongs on this host.
  const minted = await mintClientSession(
    verified.principal.tenantId,
    verified.principal.clientContactId,
    request,
  )
  if (!minted.ok || !minted.cookie) return rejected('account_unavailable')
  const res = NextResponse.redirect(`${origin}${dest}`)
  res.headers.set('Set-Cookie', minted.cookie)
  return res
}
