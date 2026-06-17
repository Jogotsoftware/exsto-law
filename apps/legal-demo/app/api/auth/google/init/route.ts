import { NextResponse } from 'next/server'
import { buildGoogleAuthUrl, type GoogleAuthMode } from '@exsto/legal'
import { readSessionFromCookieHeader } from '../../../../../lib/session'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const returnTo = url.searchParams.get('return_to') ?? '/attorney/settings'
  const modeParam = url.searchParams.get('mode')
  // Default to 'signin' — calendar/mail modes require an explicit opt-in AND a
  // verified attorney session (the connection is stored under that attorney).
  const mode: GoogleAuthMode =
    modeParam === 'calendar' ? 'calendar' : modeParam === 'mail' ? 'mail' : 'signin'

  // Sign-in mode doesn't need a tenant or actor (the callback resolves them from
  // the Google email). Calendar/mail mode connects the SIGNED-IN attorney's own
  // Google account (per-attorney, migration 0016), so we take both tenantId and
  // actorId from the server-verified session cookie — never from the request,
  // which would let one attorney connect under another's identity.
  let tenantId = '00000000-0000-0000-0000-000000000000' // placeholder for signin
  let actorId: string | null = null
  if (mode !== 'signin') {
    const session = readSessionFromCookieHeader(request.headers.get('cookie'))
    if (!session) {
      return NextResponse.json({ error: 'Sign in first to connect a calendar.' }, { status: 401 })
    }
    tenantId = session.tenantId
    actorId = session.actorId
  }

  try {
    const authUrl = buildGoogleAuthUrl(tenantId, returnTo, mode, actorId)
    return NextResponse.redirect(authUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
