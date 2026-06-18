// E-signature provider callback receiver (Session 5, WP5.2). Thin, signature-
// verified, fast-ack — mirrors the Granola webhook. Verify+normalize via the
// driver → raw_event_log → transition the envelope (esign.record_status).
// Tenant is resolved server-side inside the vertical, never from the payload.
// Provider-agnostic: the driver verifies the signature and normalizes the body,
// so a DocuSign callback would arrive at the same route behind the same driver
// interface.
import { NextResponse } from 'next/server'
import { handleEsignCallback } from '@exsto/legal'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text()
  // OpenSign HMAC header, with the common alternates; a shared-secret header
  // (x-opensign-secret) is accepted for instances that cannot HMAC-sign.
  const signature =
    req.headers.get('x-opensign-signature') ??
    req.headers.get('x-webhook-signature') ??
    req.headers.get('x-signature') ??
    req.headers.get('x-opensign-secret')

  try {
    const result = await handleEsignCallback(rawBody, signature)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(
      { ok: true, envelope_id: result.envelopeId, status: result.recordedStatus },
      { status: result.status },
    )
  } catch (err) {
    console.error('[esign webhook] failed:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
