// Public cancellation. Verifies the HMAC manage token and closes the
// consultation out through the operation core (booking.cancel) + deletes the
// firm's Google event. Token-gated and rate-limited; tenant from the signed
// token, never the request (exsto-public-surface §1).
import { NextResponse } from 'next/server'
import { cancelBookingByToken } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`booking-manage-cancel:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    reason?: unknown
  } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const reason = typeof body?.reason === 'string' ? body.reason : undefined
  try {
    await cancelBookingByToken({ token, reason })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'We could not cancel this consultation.' },
      { status: 400 },
    )
  }
}
