// Payment-provider seam → the single source of "is online payment turned on for
// this deployment." Online payment is now wired to Stripe Connect: the client
// pays on an EMBEDDED Stripe Payment Element on the invoice page (card + bank/ACH),
// so there is no redirect-to-checkout step — the pay page drives the Element via
// the `legal.client.invoice_payment_intent` portal tool, and the Stripe webhook
// flips the invoice to paid through the substrate `invoice.pay` action.
//
// `enabled` is gated on the browser-safe publishable key being present. The firm
// must ALSO have connected its Stripe account (charges enabled) for a given
// invoice to be payable; that per-firm check happens server-side in the payment-
// intent tool, which returns an `unavailable` reason the pay page surfaces.

export interface PaymentProvider {
  id: string
  /** Whether the embedded online-payment form should be offered at all. */
  enabled: boolean
}

// Reads the publishable key at module eval. NEXT_PUBLIC_ vars are inlined into the
// client bundle at build time, so this works in the browser.
export function getPaymentProvider(): PaymentProvider {
  const enabled = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  return { id: enabled ? 'stripe' : 'offline', enabled }
}
