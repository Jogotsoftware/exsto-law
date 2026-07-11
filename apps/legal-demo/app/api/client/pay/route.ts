// PORTAL-1 (WP6) — the pay MAGIC-LINK door. The invoice email's link carries a
// signed token (invoice number + tenant + expiry); this route verifies it and
// serves EXACTLY the token's invoice: view it, and open a Stripe payment
// intent. The signed-in portal reaches the same invoice through the session
// door (the authed MCP tools) — one invoice, two doors, no second token system
// beyond the #320 HMAC pattern.
import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import {
  verifyInvoicePayToken,
  resolveInvoiceClientContact,
  getClientInvoiceByNumber,
  createInvoicePaymentIntent,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'

const ACTOR_ID = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`pay-link:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    op?: unknown
  } | null
  const op = typeof body?.op === 'string' ? body.op : ''
  if (!body || typeof body.token !== 'string' || (op !== 'get' && op !== 'intent')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  let tok: { invoiceNumber: string; tenantId: string }
  try {
    tok = verifyInvoicePayToken(body.token)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'This payment link is invalid.' },
      { status: 401 },
    )
  }

  // Everything below is pinned to the TOKEN's invoice + tenant — nothing from
  // the body names an invoice.
  const ctx: ActionContext = { tenantId: tok.tenantId, actorId: ACTOR_ID }
  try {
    const contactId = await resolveInvoiceClientContact(ctx, tok.invoiceNumber)
    if (!contactId) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

    if (op === 'get') {
      const invoice = await getClientInvoiceByNumber(ctx, contactId, tok.invoiceNumber)
      if (!invoice) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
      return NextResponse.json({ invoice })
    }
    const intent = await createInvoicePaymentIntent(ctx, contactId, tok.invoiceNumber)
    return NextResponse.json({ intent })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
