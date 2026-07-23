// Public "add the next signer" (ADD-NEXT-SIGNER-1). Verifies the signing
// token and inserts a new signature_request through the operation core
// (esign.add_signer), anchored right after this token's own request. Offered
// instead of the normal "you're done" screen when the signer's role opted
// in and their signature would otherwise have completed the envelope.
// Token-gated, rate-limited — mirrors /api/sign/submit.
import { NextResponse } from 'next/server'
import { addNextSigner } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`esign-add-signer:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    name?: unknown
    email?: unknown
    title?: unknown
  } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const name = typeof body?.name === 'string' ? body.name : ''
  const email = typeof body?.email === 'string' ? body.email : ''
  const title = typeof body?.title === 'string' ? body.title : undefined

  try {
    const result = await addNextSigner({ token, name, email, title })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not add the next signer.' },
      { status: 400 },
    )
  }
}
