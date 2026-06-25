// Online payments — Stripe webhook verification/normalization + the client-portal
// allowlist. No DB: this pins the security-critical seam (a webhook only acts on a
// genuinely Stripe-signed body) and the metadata→action mapping the invoice flip
// depends on. The settled-payment recording itself (invoice.pay) is DB-gated and
// covered in payments-firm-status.test.ts.
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'

// getStripe() needs a key to instantiate (constructEvent then verifies locally —
// no network). The webhook secret is what the signature is checked against.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_dummy'

import { interpretWebhookEvent } from '@exsto/legal'
import { isClientPortalAuthedTool } from '@exsto/legal/mcp'
import { findTool } from '@exsto/mcp-tools'
import '@exsto/legal/mcp' // register tools so findTool can resolve them

// Build the Stripe-Signature header the way Stripe does: t=<unix>,v1=<hmac(t.body)>.
// A current timestamp keeps it inside constructEvent's default 5-minute tolerance.
function signedHeader(payload: string, secret = process.env.STRIPE_WEBHOOK_SECRET!): string {
  const t = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex')
  return `t=${t},v1=${sig}`
}

function eventJson(type: string, object: Record<string, unknown>): string {
  return JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object } })
}

describe('stripe webhook interpret (no DB)', () => {
  it('normalizes a signed payment_intent.succeeded, carrying its metadata', async () => {
    const payload = eventJson('payment_intent.succeeded', {
      id: 'pi_123',
      object: 'payment_intent',
      amount: 15000,
      amount_received: 15000,
      currency: 'usd',
      status: 'succeeded',
      metadata: {
        invoice_entity_id: 'inv-uuid',
        invoice_number: 'INV-001',
        tenant_id: 'tenant-uuid',
      },
    })
    const ev = await interpretWebhookEvent(payload, signedHeader(payload))
    expect(ev.type).toBe('payment_succeeded')
    if (ev.type === 'payment_succeeded') {
      expect(ev.invoiceEntityId).toBe('inv-uuid')
      expect(ev.tenantId).toBe('tenant-uuid')
      expect(ev.amountCents).toBe(15000)
      expect(ev.currency).toBe('USD')
      expect(ev.paymentIntentId).toBe('pi_123')
    }
  })

  it('rejects a body whose signature does not verify', async () => {
    const payload = eventJson('payment_intent.succeeded', { id: 'pi_x', metadata: {} })
    await expect(interpretWebhookEvent(payload, 't=1,v1=deadbeef')).rejects.toThrow()
    // a real signature over a DIFFERENT body must also fail
    const otherSig = signedHeader(eventJson('payment_intent.succeeded', { id: 'pi_other' }))
    await expect(interpretWebhookEvent(payload, otherSig)).rejects.toThrow()
  })

  it('normalizes account.updated capability flags', async () => {
    const payload = eventJson('account.updated', {
      id: 'acct_123',
      object: 'account',
      charges_enabled: true,
      details_submitted: true,
    })
    const ev = await interpretWebhookEvent(payload, signedHeader(payload))
    expect(ev.type).toBe('account_updated')
    if (ev.type === 'account_updated') {
      expect(ev.accountId).toBe('acct_123')
      expect(ev.chargesEnabled).toBe(true)
      expect(ev.detailsSubmitted).toBe(true)
    }
  })

  it('ignores event types it does not act on', async () => {
    const payload = eventJson('charge.refunded', { id: 'ch_1' })
    expect((await interpretWebhookEvent(payload, signedHeader(payload))).type).toBe('ignored')
  })
})

describe('client-portal payment tool allowlist (no DB)', () => {
  it('exposes legal.client.invoice_payment_intent to the authed portal, and it is registered', () => {
    expect(isClientPortalAuthedTool('legal.client.invoice_payment_intent')).toBe(true)
    expect(findTool('legal.client.invoice_payment_intent')).toBeTruthy()
  })

  it('does NOT expose the attorney payment tools to the client portal', () => {
    for (const attorneyOnly of [
      'legal.firm.payment_status',
      'legal.firm.payment_refresh',
      'legal.firm.payment_disconnect',
    ]) {
      expect(isClientPortalAuthedTool(attorneyOnly)).toBe(false)
    }
  })
})
