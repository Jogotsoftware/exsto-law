import { NextResponse } from 'next/server'
import { buildGoogleAuthUrl, type GoogleAuthMode } from '@exsto/legal'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const url = new URL(request.url)
  const returnTo = url.searchParams.get('return_to') ?? '/attorney/settings'
  const modeParam = url.searchParams.get('mode')
  // Default to 'signin' — calendar mode requires an explicit opt-in (and a
  // tenant_id from the signed-in session).
  const mode: GoogleAuthMode = modeParam === 'calendar' ? 'calendar' : 'signin'
  const tenantIdParam = url.searchParams.get('tenant_id')

  // Sign-in mode doesn't need a tenant (the callback resolves it from email).
  // Calendar mode requires a tenant: it's the firm that owns the calendar
  // connection. The browser is responsible for passing it from the session.
  let tenantId: string
  if (mode === 'signin') {
    tenantId = '00000000-0000-0000-0000-000000000000' // placeholder; not used in signin
  } else {
    if (!tenantIdParam || !UUID_RE.test(tenantIdParam)) {
      return NextResponse.json(
        { error: 'tenant_id is required to connect a calendar (sign in first).' },
        { status: 400 },
      )
    }
    tenantId = tenantIdParam
  }

  try {
    const authUrl = buildGoogleAuthUrl(tenantId, returnTo, mode)
    return NextResponse.redirect(authUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
