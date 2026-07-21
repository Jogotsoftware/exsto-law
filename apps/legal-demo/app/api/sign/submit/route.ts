// Public sign submission (native e-sign). Verifies the signing token and records
// the signature through the operation core (esign.sign). Token-gated, rate-limited.
import { NextResponse } from 'next/server'
import { recordSignature, loadExecutedStampPlanByToken, stampExecutedPdf } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { downloadObject, uploadObject } from '@/lib/documentStorage'

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
      signerIp: clientIpFrom(request),
    })
    // ES-2 (§5.4) / ES-MULTIDOC-1 — the final signature completes the envelope:
    // stamp the executed copy of EVERY placement-carrying PDF document in the
    // envelope (each field's resolved value drawn at its rect + the certificate
    // page appended) and store it beside its original. Best-effort: the
    // signature is already recorded and the certificate-markdown executed
    // versions already exist (the handler wrote one per document in the same
    // transaction); a stamping failure must never turn a successful signing into
    // an error. This route owns Storage bytes — the vertical never touches
    // Storage (CI storage-guard). Each document is stamped independently so one
    // bad document never blocks the rest.
    if (result.completed) {
      const plans = await loadExecutedStampPlanByToken(token).catch((planErr) => {
        console.error('esign executed-copy plan load failed:', planErr)
        return []
      })
      for (const plan of plans) {
        try {
          const original = await downloadObject(plan.objectKey)
          const stamped = await stampExecutedPdf({
            pdfBytes: original,
            fields: plan.fields,
            certificate: plan.certificate,
          })
          await uploadObject(plan.executedObjectKey, Buffer.from(stamped), 'application/pdf')
        } catch (stampErr) {
          console.error('esign executed-copy stamping failed:', stampErr)
        }
      }
    }
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not record your signature.' },
      { status: 400 },
    )
  }
}
