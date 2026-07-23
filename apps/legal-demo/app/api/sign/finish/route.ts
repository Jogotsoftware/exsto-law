// Public "no more signers — finish" (ADD-NEXT-SIGNER-1). Verifies the
// signing token and runs the deferred completion (esign.finish_signing) that
// held open when this signer's signature would otherwise have completed the
// envelope. Same stamp-executed-copy + email-everyone step /api/sign/submit
// runs on completion — this route can ALSO be the one that finishes the
// envelope. Token-gated, rate-limited.
import { NextResponse } from 'next/server'
import {
  confirmNoMoreSigners,
  loadExecutedStampPlanByToken,
  sendEnvelopeCompletionCopiesByToken,
} from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { stampExecutedCopies, stampedBytesByDocIndex } from '@/lib/esignStamping'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`esign-finish:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''

  try {
    const result = await confirmNoMoreSigners({ token })
    // Same completion-stamping step /api/sign/submit runs (esign-executed-
    // copy-complete) — best-effort: the completion is already recorded, so a
    // stamping/notify failure must never turn it into an error for the caller.
    if (result.completed) {
      const plans = await loadExecutedStampPlanByToken(token).catch((planErr) => {
        console.error('esign executed-copy plan load failed:', planErr)
        return []
      })
      const stamped = await stampExecutedCopies(plans)
      await sendEnvelopeCompletionCopiesByToken(token, stampedBytesByDocIndex(stamped)).catch(
        (notifyErr) => {
          console.error('esign completion-copy notify failed:', notifyErr)
        },
      )
    }
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not finish the envelope.' },
      { status: 400 },
    )
  }
}
