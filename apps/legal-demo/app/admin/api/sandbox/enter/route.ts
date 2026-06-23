import { NextResponse } from 'next/server'
import { resolveTenantOwner, SANDBOX_TENANT_ID } from '@exsto/legal'
import { resolveAdminCtx } from '@/lib/adminAuthSession'
import { signSession, buildSessionCookie } from '@/lib/session'

export const runtime = 'nodejs'

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

// "Enter sandbox" (ADR 0046 §6): a platform admin gets an ATTORNEY session for the
// sandbox owner so they can build/test in the full firm app, then promote. Scoped
// to the SANDBOX tenant only — never a general impersonate-any-tenant path. POST
// (not GET) so a bare top-level navigation can't trigger the session mint
// (matches the admin-logout convention).
export async function POST(request: Request) {
  const ctxOrError = await resolveAdminCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.redirect(`${BASE_URL}/admin?error=${encodeURIComponent(ctxOrError.error)}`)
  }
  const owner = await resolveTenantOwner(ctxOrError, SANDBOX_TENANT_ID)
  if (!owner) {
    return NextResponse.redirect(
      `${BASE_URL}/admin/sandbox?error=${encodeURIComponent('Sandbox owner not found.')}`,
    )
  }
  const token = signSession({
    actorId: owner.actorId,
    tenantId: SANDBOX_TENANT_ID,
    email: owner.email ?? 'sandbox@exsto.platform',
    displayName: owner.displayName,
  })
  const redirect = NextResponse.redirect(`${BASE_URL}/attorney`)
  redirect.headers.set('Set-Cookie', buildSessionCookie(token))
  return redirect
}
