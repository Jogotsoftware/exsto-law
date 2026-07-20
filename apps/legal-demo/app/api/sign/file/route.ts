// Public signer's document view for FILE envelopes (0170): streams the uploaded
// PDF behind the signing token. Token-gated and rate-limited; no session, and no
// signed Storage URL is ever issued — the bytes proxy through here with the
// token as the only door (same doctrine as the attorney/portal download routes).
import { NextResponse } from 'next/server'
import { loadEnvelopeFileRefByToken } from '@exsto/legal'
import { downloadObject } from '@/lib/documentStorage'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rl = checkPublicRateLimit(`esign-file:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  const token = new URL(request.url).searchParams.get('token') ?? ''
  try {
    const ref = await loadEnvelopeFileRefByToken(token)
    if (!ref) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    const bytes = await downloadObject(ref.objectKey)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': ref.contentType,
        'Content-Disposition': `inline; filename="${ref.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'This signing link is invalid or expired.' }, { status: 400 })
  }
}
