// Public sign submission (native e-sign). Verifies the signing token and records
// the signature through the operation core (esign.sign). Token-gated, rate-limited.
import { NextResponse } from 'next/server'
import { recordSignature } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`esign-submit:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    signatureName?: unknown
    signatureData?: unknown
    consent?: unknown
    fieldValues?: unknown
  } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const signatureName = typeof body?.signatureName === 'string' ? body.signatureName : ''
  const signatureData = typeof body?.signatureData === 'string' ? body.signatureData : null
  const consent = typeof body?.consent === 'string' ? body.consent : ''
  const fieldValues =
    body?.fieldValues && typeof body.fieldValues === 'object'
      ? (body.fieldValues as Record<string, string>)
      : undefined

  try {
    const result = await recordSignature({
      token,
      signatureName,
      signatureData,
      consent,
      fieldValues,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not record your signature.' },
      { status: 400 },
    )
  }
}
