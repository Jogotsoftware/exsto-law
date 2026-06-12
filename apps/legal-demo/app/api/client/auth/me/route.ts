import { NextResponse } from 'next/server'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'

export const runtime = 'nodejs'

// The client session cookie is httpOnly, so the client cannot read its own
// identity for display. This endpoint verifies the cookie server-side and
// returns ONLY display-safe fields (never the token, never the matter ids
// themselves — just the count for the switcher hint). 401 when there is no valid
// session, so the UI treats "not signed in" and "expired" identically.
export async function GET(request: Request) {
  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  return NextResponse.json({
    email: session.email,
    displayName: session.displayName,
    matterCount: session.matterIds.length,
  })
}
