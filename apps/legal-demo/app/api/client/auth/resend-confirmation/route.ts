// N1 — resend a portal-account confirmation email. Used by every "check your
// email" and "that link expired" surface (login page's check-email phase and
// error phase, the /book confirmation screen's account_created state) instead
// of Supabase's own auth.resend(), which would re-send GoTrue's default
// unbranded email — the exact thing this whole feature removes.
//
// Anti-enumeration: the response is the SAME regardless of whether the email
// has no account, an already-confirmed account, or an unconfirmed one — only
// the last case actually sends (resendPortalConfirmationEmail no-ops
// silently for the other two). A caller cannot learn which case they hit.
import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'
import { resendPortalConfirmationEmail } from '@/lib/portalConfirmationEmail'
import type { ConfirmationEmailLang } from '@/lib/confirmationEmailTemplate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exsto-law.netlify.app'
).replace(/\/$/, '')

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`client-auth-resend-confirmation:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown
    lang?: unknown
  } | null
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }
  const lang: ConfirmationEmailLang = body?.lang === 'es' ? 'es' : 'en'

  try {
    const pub = await resolvePublicTenant(request)
    await resendPortalConfirmationEmail(
      { tenantId: pub.tenantId, actorId: pub.actorId },
      { email, baseUrl: BASE_URL, lang },
    )
  } catch (e) {
    if (e instanceof FirmNotFoundError) {
      return NextResponse.json({ error: 'This firm could not be found.' }, { status: 404 })
    }
    // Never leak send failures — same anti-enumeration posture as the rest of
    // this response. Logged server-side by sendClientEmail/resend* already.
  }

  return NextResponse.json({ ok: true })
}
