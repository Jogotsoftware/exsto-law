import { NextResponse } from 'next/server'
import { resolveTenantOwner, SANDBOX_TENANT_ID } from '@exsto/legal'
import { resolveAdminCtx } from '@/lib/adminAuthSession'
import { requestOrigin } from '@/lib/requestOrigin'
import { signSession, buildSessionCookie } from '@/lib/session'

export const runtime = 'nodejs'

// "Enter sandbox" (ADR 0046 §6): a platform admin gets an ATTORNEY session for the
// sandbox owner so they can build/test in the full firm app, then promote. Scoped
// to the SANDBOX tenant only — never a general impersonate-any-tenant path. POST
// (not GET) so a bare top-level navigation can't trigger the session mint
// (matches the admin-logout convention).
export async function POST(request: Request) {
  // ORIGIN-1 rule 2: mint-and-redirect must stay on the host the admin is on —
  // the session cookie set below is host-only.
  const origin = requestOrigin(request)
  const ctxOrError = await resolveAdminCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.redirect(`${origin}/admin?error=${encodeURIComponent(ctxOrError.error)}`)
  }
  const owner = await resolveTenantOwner(ctxOrError, SANDBOX_TENANT_ID)
  if (!owner) {
    return NextResponse.redirect(
      `${origin}/admin/sandbox?error=${encodeURIComponent('Sandbox owner not found.')}`,
    )
  }
  const token = signSession({
    actorId: owner.actorId,
    tenantId: SANDBOX_TENANT_ID,
    email: owner.email ?? 'sandbox@exsto.platform',
    displayName: owner.displayName,
  })
  const redirect = NextResponse.redirect(`${origin}/attorney`)
  redirect.headers.set('Set-Cookie', buildSessionCookie(token))
  return redirect
}
