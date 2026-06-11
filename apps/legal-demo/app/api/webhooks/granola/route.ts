// Granola webhook receiver (REQ-CALL-02, REQ-INT-03): thin, signature-verified,
// fast-ack. Raw body → raw_event_log (via raw_event.ingest) → enqueue the
// projection worker job. Tenant is resolved server-side inside the vertical —
// never from the payload. Heavy work (transcript fetch, projection) runs in
// the worker, not here.
import { NextResponse } from 'next/server'
import { handleGranolaWebhook } from '@exsto/legal'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text()
  const signature =
    req.headers.get('x-granola-signature') ??
    req.headers.get('x-webhook-signature') ??
    req.headers.get('x-signature')

  try {
    const result = await handleGranolaWebhook(rawBody, signature)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true, job_id: result.jobId }, { status: 200 })
  } catch (err) {
    console.error('[granola webhook] failed:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
