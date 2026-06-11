import { NextResponse } from 'next/server'
import dns from 'node:dns'
import { exchangeGoogleCode } from '@exsto/legal'
import { safeInternalPath } from '@/lib/safeRedirect'

export const runtime = 'nodejs'

// AWS Lambda (Netlify Functions runtime) often can't reach IPv6 destinations
// outbound. Node 22's undici/fetch prefers v6 by default and throws
// AggregateError when v6 fails. Force v4 lookups process-wide.
dns.setDefaultResultOrder('ipv4first')

// Netlify Functions give Next.js a request.url with the internal port (80)
// baked in, which leaks into NextResponse.redirect URLs and breaks the
// browser's HTTPS handshake. Always build redirect targets off this hardcoded
// base instead of trusting request.url's origin.
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

function redirectToLoginWithError(message: string) {
  const safe = message && message.trim() ? message : 'unknown error'
  return NextResponse.redirect(`${BASE_URL}/?error=${encodeURIComponent(safe)}`)
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const errorParam = url.searchParams.get('error')

    if (errorParam) {
      return redirectToLoginWithError(`Google denied access: ${errorParam}`)
    }
    if (!code || !state) {
      return redirectToLoginWithError('Missing code or state from Google. Try signing in again.')
    }

    try {
      const result = await exchangeGoogleCode(state, code)
      // returnTo rides in the UNSIGNED OAuth state → attacker-controlled. Allow
      // only clean same-origin paths (a naive startsWith('/') lets //host through
      // as a protocol-relative open redirect).
      const safeReturnTo = safeInternalPath(result.returnTo)

      // Calendar mode just confirms the connection — no session change needed.
      if (result.mode === 'calendar') {
        const dest = `${BASE_URL}/auth/complete?email=${encodeURIComponent(result.accountEmail)}&continue=${encodeURIComponent(safeReturnTo)}&calendar_connected=1`
        return NextResponse.redirect(dest)
      }

      // Signin mode: require a resolved actor (DB allowlist).
      if (!result.actorId) {
        return redirectToLoginWithError(
          `The Google account ${result.accountEmail} is not authorized to access Pacheco Law. Sign in with an authorized account.`,
        )
      }

      const params = new URLSearchParams({
        email: result.accountEmail,
        actor_id: result.actorId,
        tenant_id: result.tenantId,
        display_name: result.displayName ?? result.accountEmail,
        continue: safeReturnTo,
      })
      return NextResponse.redirect(`${BASE_URL}/auth/complete?${params.toString()}`)
    } catch (err) {
      const message = extractErrorMessage(err, 'token exchange threw')
      console.error('[google-callback] exchange failed:', err)
      return redirectToLoginWithError(`Sign-in failed: ${message}`)
    }
  } catch (outerErr) {
    const message = extractErrorMessage(outerErr, 'callback handler crashed')
    console.error('[google-callback] catastrophic failure:', outerErr)
    return redirectToLoginWithError(`Server error: ${message}`)
  }
}

function extractErrorMessage(err: unknown, fallback: string): string {
  // AggregateError carries an `errors` array with the underlying failures
  // (typical of fetch() trying both IPv6 and IPv4). Surface the first one.
  if (
    err &&
    typeof err === 'object' &&
    'errors' in err &&
    Array.isArray((err as { errors: unknown[] }).errors)
  ) {
    const inner = (err as { errors: unknown[] }).errors
    const parts = inner.map((e) =>
      e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e),
    )
    return `AggregateError (${parts.length}): ${parts.join(' | ')}`
  }
  if (err instanceof Error && err.message) return err.message
  const s = String(err)
  return s && s !== '[object Object]' ? s : fallback
}
