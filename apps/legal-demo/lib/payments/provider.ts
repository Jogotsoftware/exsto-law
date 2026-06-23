// Payment-provider seam. The client invoice view ("view invoices") is live now;
// online card payment is not. This interface is where a provider (Stripe, etc.)
// drops in later WITHOUT touching the pay page or the invoice tools.
//
// When a provider is wired:
//   • implement `startCheckout` (e.g. create a Stripe Checkout Session) and return
//     its redirect URL,
//   • set `enabled: true` behind the provider's env keys,
//   • on the provider's webhook, call the substrate `invoice.pay` action (the
//     same one the attorney's "Mark paid" uses) so the invoice flips to 'paid'.
// Until then `getPaymentProvider()` returns the offline (no-op) provider and the
// pay page shows how to pay by check / bank transfer.

export interface PaymentCheckoutArgs {
  invoiceNumber: string
  amount: string
  currency: string
}

export interface PaymentProvider {
  id: string
  /** Whether online payment can be started right now. */
  enabled: boolean
  /** Begin a payment; resolves to a URL to redirect the client to. */
  startCheckout?(args: PaymentCheckoutArgs): Promise<{ url: string }>
}

// No online provider wired yet. Pay offline; the firm sends payment details.
export const offlineProvider: PaymentProvider = { id: 'offline', enabled: false }

// Return the configured provider. Today only the offline provider exists; wiring
// Stripe means adding a stripeProvider and returning it here when its keys are set
// (e.g. `if (process.env.NEXT_PUBLIC_STRIPE_PK) return stripeProvider`).
export function getPaymentProvider(): PaymentProvider {
  return offlineProvider
}
