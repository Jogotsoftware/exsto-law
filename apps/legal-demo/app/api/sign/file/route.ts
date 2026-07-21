// Public signer's document view for FILE envelopes (0170): streams the uploaded
// PDF behind the signing token. Token-gated and rate-limited; no session, and no
// signed Storage URL is ever issued — the bytes proxy through here with the
// token as the only door (same doctrine as the attorney/portal download routes).
import { NextResponse } from 'next/server'
import { loadEnvelopeFileRefByToken, executedPdfObjectKey } from '@exsto/legal'
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
  const params = new URL(request.url).searchParams
  const token = params.get('token') ?? ''
  // ES-MULTIDOC-1 — `?doc=N` selects one document in a multi-document envelope
  // (0-based, in send order). Absent ⇒ the primary (doc 0), unchanged.
  const docIndex = Math.max(0, Number.parseInt(params.get('doc') ?? '0', 10) || 0)
  try {
    const ref = await loadEnvelopeFileRefByToken(token, docIndex)
    if (!ref) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    // ES-2 (§5.4) — once the envelope completes, a stamped executed copy exists
    // beside the original (derived key); prefer it so a signer returning to
    // their link sees the executed document. Mid-flow it doesn't exist yet and
    // the original streams (the fallback).
    const bytes = await downloadObject(executedPdfObjectKey(ref.objectKey)).catch(() =>
      downloadObject(ref.objectKey),
    )
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
