// Public sign page data loader (native e-sign). Verifies the signing token and
// returns the document + signer context to render. Token-gated and rate-limited;
// no session. Importing @exsto/legal registers the action handlers used downstream.
import { NextResponse } from 'next/server'
import { loadSignableDocument } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`esign-load:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  try {
    const document = await loadSignableDocument(token, clientIpFrom(request))
    return NextResponse.json({ ok: true, document })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'This signing link is invalid or expired.' },
      { status: 400 },
    )
  }
}
