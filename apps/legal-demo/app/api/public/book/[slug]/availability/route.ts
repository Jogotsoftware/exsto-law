import { NextResponse } from 'next/server'
import { getPublicAvailability } from '@exsto/legal'
import '@exsto/legal' // load the legal module graph (side effect)
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

// BOOKING-FRONTDOOR-1 WP3 — public availability for a firm's booking slug. The slug
// resolves the firm (SECURITY DEFINER, migration 0119); availability is REAL Google
// free/busy only (never stub). Unauthenticated + per-IP rate limited.
export const runtime = 'nodejs'

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const rl = checkPublicRateLimit(clientIpFrom(request))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const url = new URL(request.url)
  const duration = Number(url.searchParams.get('duration')) || undefined
  const daysOut = Number(url.searchParams.get('days')) || undefined

  try {
    const avail = await getPublicAvailability(slug, { durationMinutes: duration, daysOut })
    if (!avail) {
      return NextResponse.json({ error: 'This booking link was not found.' }, { status: 404 })
    }
    return NextResponse.json(avail)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
