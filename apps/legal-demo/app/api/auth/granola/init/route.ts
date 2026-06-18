import { NextResponse } from 'next/server'
import { buildGranolaConnectUrl } from '@exsto/legal'
import { readSessionFromCookieHeader } from '@/lib/session'

export const runtime = 'nodejs'

// Start the Granola per-attorney browser OAuth (WP1.2). Requires a signed-in
// attorney — the connection is stored under THAT attorney (per migration 0016),
// taken from the server-verified session cookie, never the request. The PKCE
// verifier is kept in a short-lived httpOnly cookie (it must not ride in the
// signed-but-readable OAuth state); the callback reads it back.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const returnTo = url.searchParams.get('return_to') ?? '/attorney/settings'
  const session = readSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) {
    return NextResponse.json({ error: 'Sign in first to connect Granola.' }, { status: 401 })
  }
  try {
    const { url: authUrl, verifier } = await buildGranolaConnectUrl(
      session.tenantId,
      returnTo,
      session.actorId,
    )
    const res = NextResponse.redirect(authUrl)
    res.cookies.set('granola_pkce', verifier, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
