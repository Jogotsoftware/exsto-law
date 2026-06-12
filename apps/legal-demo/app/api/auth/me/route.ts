import { NextResponse } from 'next/server'
import { readSessionFromCookieHeader } from '@/lib/session'

export const runtime = 'nodejs'

// The session cookie is httpOnly, so the client cannot read its own identity for
// display. This endpoint verifies the cookie server-side and returns the safe,
// display-only fields (never the token). 401 when there is no valid session, so
// the UI can treat "not signed in" and "expired" identically.
export async function GET(request: Request) {
  const session = readSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  return NextResponse.json({
    email: session.email,
    displayName: session.displayName,
    actorId: session.actorId,
    tenantId: session.tenantId,
  })
}
