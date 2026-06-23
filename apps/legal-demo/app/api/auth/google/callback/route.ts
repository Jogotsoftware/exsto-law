import { NextResponse } from 'next/server'
import dns from 'node:dns'
import { exchangeGoogleCode, resolvePlatformAdminByEmail } from '@exsto/legal'
import { safeInternalPath } from '@/lib/safeRedirect'
import { signSession, buildSessionCookie } from '@/lib/session'
import { signAdminSession, buildAdminSessionCookie } from '@/lib/adminSession'

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
      // returnTo is part of the HMAC-signed OAuth state, so callback-side tampering
      // is already rejected by verifyOAuthState before we get here. safeInternalPath
      // stays as defense-in-depth (and is the real guard for /auth/complete, which
      // is directly reachable with an unsigned ?continue= param): allow only clean
      // same-origin paths (a naive startsWith('/') lets //host through as a
      // protocol-relative open redirect).
      const safeReturnTo = safeInternalPath(result.returnTo)

      // Admin-console sign-in (ADR 0046): resolve the verified Google email to a
      // PLATFORM admin (cp_resolve_admin_by_email), then mint the SEPARATE admin
      // session cookie. Never the attorney session. Unknown / non-admin emails are
      // rejected to the admin sign-in page.
      if (result.mode === 'admin') {
        const admin = await resolvePlatformAdminByEmail(result.accountEmail)
        if (!admin) {
          return NextResponse.redirect(
            `${BASE_URL}/admin?error=${encodeURIComponent(
              `${result.accountEmail} is not a platform admin.`,
            )}`,
          )
        }
        const candidate = safeInternalPath(result.returnTo, '/admin')
        // An admin sign-in must land inside /admin — never the attorney app.
        const adminReturnTo = candidate.startsWith('/admin') ? candidate : '/admin'
        const token = signAdminSession({
          actorId: admin.actorId,
          tenantId: admin.tenantId,
          email: result.accountEmail,
          displayName: admin.displayName ?? result.accountEmail,
        })
        const redirect = NextResponse.redirect(`${BASE_URL}${adminReturnTo}`)
        redirect.headers.set('Set-Cookie', buildAdminSessionCookie(token))
        return redirect
      }

      // A connect (calendar or mail mode) just confirms the connection — no
      // session change. Both now request the full Google scope set, so either
      // mode lands here; only 'signin' continues to the actor-resolution path.
      if (result.mode === 'calendar' || result.mode === 'mail') {
        const dest = `${BASE_URL}/auth/complete?email=${encodeURIComponent(result.accountEmail)}&continue=${encodeURIComponent(safeReturnTo)}&calendar_connected=1`
        return NextResponse.redirect(dest)
      }

      // Signin mode: require a resolved actor (DB allowlist).
      if (!result.actorId) {
        return redirectToLoginWithError(
          `The Google account ${result.accountEmail} is not authorized to access Pacheco Law. Sign in with an authorized account.`,
        )
      }

      // Mint a signed, httpOnly session cookie server-side. The identity NEVER
      // rides in the redirect URL anymore (it used to: actor_id/tenant_id/email
      // in the query string were visible to the browser/JS and not the basis of
      // any server check). The cookie is the only authority; the client reads
      // its display fields via /api/auth/me, never the token itself.
      const token = signSession({
        actorId: result.actorId,
        tenantId: result.tenantId,
        email: result.accountEmail,
        displayName: result.displayName ?? result.accountEmail,
      })
      const redirect = NextResponse.redirect(`${BASE_URL}${safeReturnTo}`)
      redirect.headers.set('Set-Cookie', buildSessionCookie(token))
      return redirect
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
