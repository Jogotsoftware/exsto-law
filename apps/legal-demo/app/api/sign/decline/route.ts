// Public sign decline (native e-sign). Verifies the signing token and records a
// decline through the operation core (esign.decline). Token-gated, rate-limited.
import { NextResponse } from 'next/server'
import { declineSignature } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`esign-decline:${clientIpFrom(request)}`)
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
    const result = await declineSignature({ token, reason })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not record your decision.' },
      { status: 400 },
    )
  }
}
