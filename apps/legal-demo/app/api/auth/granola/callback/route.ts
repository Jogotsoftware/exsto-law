import { NextResponse } from 'next/server'
import dns from 'node:dns'
import { exchangeGranolaConnect } from '@exsto/legal'
import { safeInternalPath } from '@/lib/safeRedirect'

export const runtime = 'nodejs'

// See the Google callback for why these are needed on the Netlify Functions
// runtime (IPv6 reachability + a hardcoded HTTPS base for redirect targets).
dns.setDefaultResultOrder('ipv4first')
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

function redirectToSettingsError(message: string) {
  const safe = message && message.trim() ? message : 'unknown error'
  return NextResponse.redirect(
    `${BASE_URL}/attorney/settings?granola_error=${encodeURIComponent(safe)}`,
  )
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const errorParam = url.searchParams.get('error')

    if (errorParam) return redirectToSettingsError(`Granola denied access: ${errorParam}`)
    if (!code || !state) return redirectToSettingsError('Missing code or state from Granola.')

    // PKCE verifier from the httpOnly cookie set at init.
    const cookie = request.headers.get('cookie') ?? ''
    const rawVerifier = /(?:^|;\s*)granola_pkce=([^;]+)/.exec(cookie)?.[1] ?? null
    const verifier = rawVerifier ? decodeURIComponent(rawVerifier) : null

    const result = await exchangeGranolaConnect(state, code, verifier)
    const safeReturnTo = safeInternalPath(result.returnTo)
    const res = NextResponse.redirect(`${BASE_URL}${safeReturnTo}?granola_connected=1`)
    // Clear the one-shot PKCE cookie.
    res.cookies.set('granola_pkce', '', { path: '/', maxAge: 0 })
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[granola-callback] exchange failed:', err)
    return redirectToSettingsError(`Granola connection failed: ${message}`)
  }
}
