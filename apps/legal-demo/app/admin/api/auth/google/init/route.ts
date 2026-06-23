import { NextResponse } from 'next/server'
import { buildGoogleAuthUrl } from '@exsto/legal'

export const runtime = 'nodejs'

// Platform admin-console sign-in (ADR 0046). Reuses the shared Google OAuth
// callback (/api/auth/google/callback) — same redirect_uri, no new one to
// register — but with mode='admin' so the callback resolves the email to a
// platform admin and mints the SEPARATE admin session cookie. Identity-only
// scope; no session required to start (the callback is the gate).
const PLATFORM_TENANT_ID = '00000000-0000-0000-00FF-000000000001'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requested = url.searchParams.get('return_to') ?? '/admin/tenants'
  // Constrain the landing path to the admin surface.
  const returnTo = requested.startsWith('/admin') ? requested : '/admin/tenants'
  try {
    const authUrl = buildGoogleAuthUrl(PLATFORM_TENANT_ID, returnTo, 'admin', null)
    return NextResponse.redirect(authUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
