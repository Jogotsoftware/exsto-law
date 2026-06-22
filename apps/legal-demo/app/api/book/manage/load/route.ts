// Public "manage my appointment" data loader. Verifies the HMAC manage token
// and returns the booking details to render. Token-gated and rate-limited; no
// session. Importing @exsto/legal registers the action handlers used downstream.
import { NextResponse } from 'next/server'
import { loadManageableBooking } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`booking-manage-load:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  try {
    const booking = await loadManageableBooking(token)
    return NextResponse.json({ ok: true, booking })
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'This appointment link is invalid or expired.',
      },
      { status: 400 },
    )
  }
}
