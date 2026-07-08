import { NextResponse } from 'next/server'
import { submitPublicBooking } from '@exsto/legal'
import '@exsto/legal' // register action handlers (side effect)
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { verifyCaptchaIfConfigured } from '@/lib/captcha'

// BOOKING-FRONTDOOR-1 WP4 — confirm a standalone booking. Unauthenticated; runs as the
// firm's public-intake actor (resolved inside submitPublicBooking from the slug). Rate
// limited + CAPTCHA-gated (no-op until a secret is configured) like the other public
// writes. A visible error on any failure — never a silent dead-end. maxDuration is
// raised because it may write a Google Calendar event.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const rl = checkPublicRateLimit(clientIpFrom(request))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as
    | (Record<string, unknown> & { captchaToken?: string })
    | null
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const captcha = await verifyCaptchaIfConfigured(body.captchaToken, clientIpFrom(request))
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.reason ?? 'Captcha required.' }, { status: 403 })
  }

  try {
    const res = await submitPublicBooking({
      slug,
      clientName: String(body.clientName ?? ''),
      clientEmail: String(body.clientEmail ?? ''),
      clientPhone: body.clientPhone ? String(body.clientPhone) : null,
      reason: body.reason ? String(body.reason) : null,
      startIso: String(body.startIso ?? ''),
      endIso: String(body.endIso ?? ''),
      durationMinutes: body.durationMinutes ? Number(body.durationMinutes) : undefined,
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
