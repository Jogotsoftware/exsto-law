// Stripe webhook receiver. Thin, signature-verified, fast-ack — mirrors the
// Granola / esign webhooks. The raw body is required for Stripe signature
// verification, so read it with req.text() BEFORE any parsing; the vertical
// verifies + interprets it and records the payment through the SAME invoice.pay
// action the attorney's "Mark paid" uses. Tenant is resolved server-side (from
// the PaymentIntent metadata we set), never trusted from an unsigned source.
import { NextResponse } from 'next/server'
import { handleStripeWebhook } from '@exsto/legal'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature')

  try {
    const result = await handleStripeWebhook(rawBody, signature)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true, handled: result.handled }, { status: result.status })
  } catch (err) {
    console.error('[stripe webhook] failed:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
