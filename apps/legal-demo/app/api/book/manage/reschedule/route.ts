// Public reschedule submission. Verifies the HMAC manage token and moves the
// consultation through the operation core (booking.update) + the firm's Google
// calendar. Token-gated and rate-limited; the tenant comes from the signed
// token, never the request (exsto-public-surface §1).
import { NextResponse } from 'next/server'
import { rescheduleBookingByToken } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`booking-manage-reschedule:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    startIso?: unknown
    endIso?: unknown
  } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const startIso = typeof body?.startIso === 'string' ? body.startIso : ''
  const endIso = typeof body?.endIso === 'string' ? body.endIso : ''
  if (!startIso || !endIso) {
    return NextResponse.json({ error: 'Please choose a new time.' }, { status: 400 })
  }
  try {
    await rescheduleBookingByToken({ token, startIso, endIso })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'We could not reschedule this consultation.' },
      { status: 400 },
    )
  }
}
