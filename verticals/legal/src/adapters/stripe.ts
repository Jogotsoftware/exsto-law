// Stripe adapter — the ONLY place that talks to the Stripe API (vertical rule,
// mirroring the Claude / Perplexity adapters). exsto-law is the Stripe Connect
// PLATFORM; each firm is an Express CONNECTED ACCOUNT. The platform secret key
// (STRIPE_SECRET_KEY) is exsto-law's, an env var — there is no per-firm key. A
// firm's connected-account id (acct_…) is a public identifier, not a secret, and
// is recorded as config-as-data on firm_settings (see api/payments.ts).
//
// Charges are DIRECT charges on the connected account: the firm is the merchant
// of record (correct for legal fees / trust rules). The PaymentIntent is created
// with the `{ stripeAccount }` request option so it lives on the firm's account;
// the embedded Payment Element surfaces card + us_bank_account (ACH — bank login
// via Financial Connections, or manual account/routing entry) via
// automatic_payment_methods. An optional platform application fee defaults to 0.
import Stripe from 'stripe'
import { loadConnection } from './connectionStore.js'
import { PLATFORM_TENANT_ID } from '../controlPlane/context.js'

// Thrown when the platform Stripe key is absent (online payments not configured
// for this deployment). Mirrors EsignNotConfiguredError so callers can surface a
// clean "not available" instead of a 500.
export class StripeNotConfiguredError extends Error {
  constructor(message = 'Online payments are not configured (no Stripe platform key).') {
    super(message)
    this.name = 'StripeNotConfiguredError'
  }
}

// The platform Stripe credentials are exsto-law's own (one set for the whole
// product), provisioned by a platform admin and stored ENCRYPTED in Vault under
// the platform tenant — the same secure store the Anthropic/Perplexity keys use.
// Env vars are a FALLBACK (local dev / bootstrap before anything is saved). The
// secret + webhook secret never leave the server; only the publishable key is
// browser-safe and is handed to the client by createInvoicePaymentIntent.
export interface StripeCredentials {
  secretKey: string | null
  publishableKey: string | null
  webhookSecret: string | null
}

interface StripeVaultSecret {
  secret_key?: string
  publishable_key?: string
  webhook_secret?: string
}

// Resolve the platform credentials: Vault wins (the UI is authoritative), env is
// the fallback. A missing/unreachable DB (e.g. unit tests) degrades to env, never
// throws. Per-field so a partially-configured platform still works.
export async function getStripeCredentials(): Promise<StripeCredentials> {
  let vault: StripeVaultSecret | null = null
  try {
    const conn = await loadConnection<StripeVaultSecret>(PLATFORM_TENANT_ID, 'stripe')
    vault = conn?.secret ?? null
  } catch {
    vault = null
  }
  return {
    secretKey: vault?.secret_key || process.env.STRIPE_SECRET_KEY || null,
    publishableKey:
      vault?.publishable_key || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
    webhookSecret: vault?.webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || null,
  }
}

/** True when a platform Stripe secret key resolves (Vault or env). */
export async function isStripeConfigured(): Promise<boolean> {
  return (await getStripeCredentials()).secretKey != null
}

/** The publishable key the embedded Payment Element needs (browser-safe). */
export async function stripePublishableKey(): Promise<string | null> {
  return (await getStripeCredentials()).publishableKey
}

// Memoised platform client, keyed by the resolved secret so a key change in the
// UI takes effect without a restart. apiVersion is intentionally omitted so the
// SDK uses the version it is pinned to (avoids literal-type drift on upgrade).
let cachedClient: Stripe | null = null
let cachedKey: string | null = null
async function getStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials()
  if (!secretKey) throw new StripeNotConfiguredError()
  if (cachedClient && cachedKey === secretKey) return cachedClient
  cachedClient = new Stripe(secretKey)
  cachedKey = secretKey
  return cachedClient
}

// "Test connection" probe: verify a secret key works AND that Connect is enabled
// (accounts.list only succeeds on a Connect platform). Returns null on success or
// a user-facing error string. Used by the admin Payments setup screen before save.
export async function verifyStripeSecretKey(secretKey: string): Promise<string | null> {
  try {
    const probe = new Stripe(secretKey)
    await probe.accounts.list({ limit: 1 })
    return null
  } catch (err) {
    const e = err as { message?: string; raw?: { message?: string } }
    return e.raw?.message ?? e.message ?? 'Could not verify the Stripe secret key.'
  }
}

export interface ConnectedAccountStatus {
  chargesEnabled: boolean
  detailsSubmitted: boolean
  payoutsEnabled: boolean
}

// Create a new Express connected account for a firm. Requests the capabilities a
// legal practice needs: card payments, transfers (so funds settle to the firm),
// and us_bank_account ACH (low-fee bank payment for large invoices).
export async function createExpressAccount(): Promise<string> {
  const account = await (
    await getStripeClient()
  ).accounts.create({
    type: 'express',
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
      us_bank_account_ach_payments: { requested: true },
    },
  })
  return account.id
}

// A one-time onboarding link for the firm to complete Express KYC/bank setup.
// Stripe requires BOTH a return_url (onboarding done/abandoned) and a refresh_url
// (the link expired — mint a fresh one).
export async function createAccountLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const link = await (
    await getStripeClient()
  ).accountLinks.create({
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: 'account_onboarding',
  })
  return link.url
}

/** Read the live capability flags Stripe reports for a connected account. */
export async function retrieveAccount(accountId: string): Promise<ConnectedAccountStatus> {
  const a = await (await getStripeClient()).accounts.retrieve(accountId)
  return {
    chargesEnabled: a.charges_enabled ?? false,
    detailsSubmitted: a.details_submitted ?? false,
    payoutsEnabled: a.payouts_enabled ?? false,
  }
}

export interface CreatePaymentIntentArgs {
  accountId: string
  amountCents: number
  currency: string
  /** Echoed back on the webhook event so it can resolve the invoice w/o a lookup. */
  metadata: Record<string, string>
  /** Optional platform fee in cents (default 0 = no platform cut). */
  applicationFeeCents?: number
}

export interface CreatedPaymentIntent {
  id: string
  clientSecret: string
}

// Create a DIRECT-charge PaymentIntent on the firm's connected account. The
// `{ stripeAccount }` option is what makes it a direct charge (firm = merchant of
// record). automatic_payment_methods lets the Payment Element offer card + ACH.
export async function createConnectedPaymentIntent(
  args: CreatePaymentIntentArgs,
): Promise<CreatedPaymentIntent> {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: args.amountCents,
    currency: args.currency.toLowerCase(),
    automatic_payment_methods: { enabled: true },
    metadata: args.metadata,
  }
  if (args.applicationFeeCents && args.applicationFeeCents > 0) {
    params.application_fee_amount = args.applicationFeeCents
  }
  const intent = await (
    await getStripeClient()
  ).paymentIntents.create(params, { stripeAccount: args.accountId })
  if (!intent.client_secret) {
    throw new Error('Stripe did not return a client secret for the payment intent.')
  }
  return { id: intent.id, clientSecret: intent.client_secret }
}

// Verify + parse a webhook delivery. Throws if the signature doesn't match the
// resolved webhook secret (the route returns 400). The raw (unparsed) body is
// required for signature verification.
export async function constructWebhookEvent(
  rawBody: string,
  signature: string | null,
): Promise<Stripe.Event> {
  const { webhookSecret } = await getStripeCredentials()
  if (!webhookSecret) throw new StripeNotConfiguredError('Stripe webhook secret is not set.')
  if (!signature) throw new Error('Missing Stripe-Signature header.')
  return (await getStripeClient()).webhooks.constructEvent(rawBody, signature, webhookSecret)
}

// The Stripe event types the app acts on, normalized so the rest of the vertical
// never imports Stripe types (keeps this adapter the only Stripe-aware module).
export type NormalizedStripeEvent =
  | {
      type: 'payment_succeeded'
      invoiceEntityId: string | null
      tenantId: string | null
      amountCents: number
      currency: string
      paymentIntentId: string
    }
  | {
      type: 'account_updated'
      accountId: string
      chargesEnabled: boolean
      detailsSubmitted: boolean
    }
  | { type: 'ignored'; eventType: string }

// Verify the signature then narrow the event to the shapes the payments API
// cares about. Everything else is 'ignored' (the route still 200s so Stripe stops
// retrying). invoice_entity_id + tenant_id ride in the PaymentIntent metadata we
// set at creation, so payment_succeeded carries them back with no DB lookup.
export async function interpretWebhookEvent(
  rawBody: string,
  signature: string | null,
): Promise<NormalizedStripeEvent> {
  const event = await constructWebhookEvent(rawBody, signature)
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent
      const md = pi.metadata ?? {}
      return {
        type: 'payment_succeeded',
        invoiceEntityId: md.invoice_entity_id ?? null,
        tenantId: md.tenant_id ?? null,
        amountCents: pi.amount_received || pi.amount,
        currency: (pi.currency ?? 'usd').toUpperCase(),
        paymentIntentId: pi.id,
      }
    }
    case 'account.updated': {
      const acct = event.data.object as Stripe.Account
      return {
        type: 'account_updated',
        accountId: acct.id,
        chargesEnabled: acct.charges_enabled ?? false,
        detailsSubmitted: acct.details_submitted ?? false,
      }
    }
    default:
      return { type: 'ignored', eventType: event.type }
  }
}
