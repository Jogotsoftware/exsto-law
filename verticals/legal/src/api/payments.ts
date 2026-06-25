// Online invoice payments — the firm/connection + client/checkout API over the
// Stripe adapter (migration 0113). Writes go THROUGH THE CORE via submitAction
// (vertical rule); reads use withActionContext, tenant-scoped, latest-valid.
//
// Two surfaces:
//   • FIRM (attorney): start Express onboarding, refresh capability flags, read
//     status, disconnect. The connected-account id + flags live as config-as-data
//     on the firm_settings singleton.
//   • CLIENT (portal): createInvoicePaymentIntent authorises the invoice to the
//     signed-in client (via the existing client-safe getClientInvoiceByNumber),
//     then opens a direct-charge PaymentIntent on the firm's connected account.
//
// The settled-payment fact is recorded by recordStripePayment from the webhook —
// it calls the SAME invoice.pay action the attorney's "Mark paid" uses (migration
// 0090 designed this seam), and is idempotent against duplicate deliveries.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { withSuperuser, type DbClient } from '@exsto/shared'
import {
  isStripeConfigured,
  stripePublishableKey,
  createExpressAccount,
  createAccountLink,
  retrieveAccount,
  createConnectedPaymentIntent,
  hasInFlightPaymentIntent,
  interpretWebhookEvent,
  StripeNotConfiguredError,
} from '../adapters/stripe.js'
import { getClientInvoiceByNumber } from '../queries/clientBilling.js'

// The firm's public-intake SYSTEM actor — the webhook records payments as this
// actor (the client's identity lives on client_contact, not the action actor;
// mirrors granolaIngestion's ingestionContext). Overridable for tests/deploys.
const SYSTEM_ACTOR = '00000000-0000-0000-0001-000000000001'

export interface FirmPaymentStatus {
  /** Platform Stripe keys present on this deployment at all. */
  configured: boolean
  /** The firm has a connected account id (onboarding started). */
  connected: boolean
  /** Stripe reports the account can accept charges. */
  chargesEnabled: boolean
  /** Express onboarding details fully submitted. */
  detailsSubmitted: boolean
  accountId: string | null
}

interface FirmStripeRow {
  account_id: string | null
  charges_enabled: string | null
  details_submitted: string | null
}

// Resolve the firm_settings singleton and read the three Stripe attrs in one
// query (latest valid_from each). Booleans come back as 'true'/'false' strings
// (json #>> '{}'); null account id means "not connected".
async function readFirmStripe(client: DbClient, tenantId: string): Promise<FirmStripeRow> {
  const sub = (kind: string): string =>
    `(SELECT a.value #>> '{}' FROM attribute a
        JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = '${kind}'
         AND (a.valid_to IS NULL OR a.valid_to > now())
       ORDER BY a.valid_from DESC LIMIT 1)`
  const res = await client.query<FirmStripeRow>(
    `SELECT ${sub('stripe_connected_account_id')} AS account_id,
            ${sub('stripe_charges_enabled')}      AS charges_enabled,
            ${sub('stripe_details_submitted')}    AS details_submitted
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND ekd.kind_name = 'firm_settings' AND e.status = 'active'
      ORDER BY e.created_at ASC LIMIT 1`,
    [tenantId],
  )
  return res.rows[0] ?? { account_id: null, charges_enabled: null, details_submitted: null }
}

/** The firm's current payment-connection status. */
export async function getFirmPaymentStatus(ctx: ActionContext): Promise<FirmPaymentStatus> {
  return withActionContext(ctx, async (client) => {
    const r = await readFirmStripe(client, ctx.tenantId)
    const accountId = (r.account_id ?? '').trim() || null
    return {
      configured: await isStripeConfigured(),
      connected: !!accountId,
      chargesEnabled: r.charges_enabled === 'true',
      detailsSubmitted: r.details_submitted === 'true',
      accountId,
    }
  })
}

// Whether this tenant's registry actually carries the Stripe action kind. Kinds
// are per-tenant; a firm whose registry predates the kinds (or never got them)
// would fail the connect_stripe write. We check this BEFORE creating a Stripe
// account so a missing kind can never orphan a real Express account at Stripe.
async function stripeConnectKindAvailable(ctx: ActionContext): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM action_kind_definition
          WHERE tenant_id = $1 AND kind_name = 'legal.firm.connect_stripe' AND status = 'active'
       ) AS ok`,
      [ctx.tenantId],
    )
    return r.rows[0]?.ok === true
  })
}

// Begin (or resume) Express onboarding. Reuses the firm's existing connected
// account if it has one, else creates one and records its id. Returns the
// Stripe-hosted onboarding URL to redirect the attorney to.
export async function startFirmOnboarding(
  ctx: ActionContext,
  baseUrl: string,
): Promise<{ url: string }> {
  if (!(await isStripeConfigured())) throw new StripeNotConfiguredError()
  // Pre-flight: never create a Stripe account we can't record locally (would
  // orphan a live Express account at Stripe on every attempt).
  if (!(await stripeConnectKindAvailable(ctx))) {
    throw new StripeNotConfiguredError('Online payments aren’t enabled for this firm yet.')
  }
  const status = await getFirmPaymentStatus(ctx)
  let accountId = status.accountId
  if (!accountId) {
    accountId = await createExpressAccount()
    await submitAction(ctx, {
      actionKindName: 'legal.firm.connect_stripe',
      intentKind: 'adjustment',
      payload: { account_id: accountId },
    })
  }
  const url = await createAccountLink(
    accountId,
    `${baseUrl}/api/billing/connect/return`,
    `${baseUrl}/api/billing/connect/refresh`,
  )
  return { url }
}

// Pull the live capability flags from Stripe and persist them. Called from the
// onboarding return route and the manual "refresh" tool. A no-op (returns the
// current status) when the firm has no connected account yet.
export async function refreshFirmPaymentStatus(ctx: ActionContext): Promise<FirmPaymentStatus> {
  const status = await getFirmPaymentStatus(ctx)
  if (!status.accountId) return status
  const live = await retrieveAccount(status.accountId)
  await submitAction(ctx, {
    actionKindName: 'legal.firm.connect_stripe',
    intentKind: 'adjustment',
    payload: {
      account_id: status.accountId,
      charges_enabled: live.chargesEnabled,
      details_submitted: live.detailsSubmitted,
    },
  })
  return {
    ...status,
    connected: true,
    chargesEnabled: live.chargesEnabled,
    detailsSubmitted: live.detailsSubmitted,
  }
}

/** Stop accepting online payments (clears the local connection). */
export async function disconnectFirmPayments(ctx: ActionContext): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'legal.firm.disconnect_stripe',
    intentKind: 'adjustment',
    payload: {},
  })
}

export type InvoicePaymentIntentResult =
  | {
      status: 'ready'
      clientSecret: string
      publishableKey: string
      connectedAccountId: string
      amountCents: number
      currency: string
      invoiceNumber: string
    }
  | { status: 'unavailable'; reason: string }

// A decimal-string money value (ADR 0044) → integer cents. Returns null on a
// malformed/empty/negative total (the caller treats it as unavailable).
function toCents(decimal: string): number | null {
  if (!/^\d+(\.\d+)?$/.test((decimal ?? '').trim())) return null
  const cents = Math.round(Number(decimal) * 100)
  return Number.isFinite(cents) && cents > 0 ? cents : null
}

// Open a payment for ONE of the signed-in client's own invoices. Authorisation
// is the client-safe getClientInvoiceByNumber (scoped to the client's matters,
// issued/sent/paid only). The invoice entity id + tenant ride in the PaymentIntent
// metadata so the webhook resolves the invoice without a lookup.
export async function createInvoicePaymentIntent(
  ctx: ActionContext,
  clientContactId: string,
  invoiceNumber: string,
): Promise<InvoicePaymentIntentResult> {
  const publishableKey = await stripePublishableKey()
  if (!publishableKey || !(await isStripeConfigured())) {
    return { status: 'unavailable', reason: 'Online payment isn’t set up for this firm yet.' }
  }
  const invoice = await getClientInvoiceByNumber(ctx, clientContactId, invoiceNumber)
  if (!invoice) return { status: 'unavailable', reason: 'Invoice not found.' }
  if (invoice.status === 'paid') {
    return { status: 'unavailable', reason: 'This invoice has already been paid.' }
  }
  const firm = await getFirmPaymentStatus(ctx)
  if (!firm.connected || !firm.accountId || !firm.chargesEnabled) {
    return {
      status: 'unavailable',
      reason: 'The firm isn’t set up to accept online payments yet.',
    }
  }
  const amountCents = toCents(invoice.total)
  if (amountCents == null) {
    return { status: 'unavailable', reason: 'This invoice has no amount due.' }
  }
  // Don't open a second charge while a bank/ACH payment is still clearing — the
  // invoice reads 'due' for days during settlement, so without this a revisit
  // could double-charge. (Cards settle instantly → the paid-guard covers them.)
  if (await hasInFlightPaymentIntent(firm.accountId, invoice.invoiceEntityId)) {
    return {
      status: 'unavailable',
      reason:
        'A bank payment for this invoice is already processing — it can take a few business days to clear.',
    }
  }
  const currency = (invoice.currency || 'USD').toUpperCase()
  const pi = await createConnectedPaymentIntent({
    accountId: firm.accountId,
    amountCents,
    currency,
    metadata: {
      invoice_entity_id: invoice.invoiceEntityId,
      invoice_number: invoice.invoiceNumber,
      tenant_id: ctx.tenantId,
    },
  })
  return {
    status: 'ready',
    clientSecret: pi.clientSecret,
    publishableKey,
    connectedAccountId: firm.accountId,
    amountCents,
    currency,
    invoiceNumber: invoice.invoiceNumber,
  }
}

export interface RecordStripePaymentArgs {
  invoiceEntityId: string
  tenantId: string
  amountCents: number
  currency: string
  paymentIntentId: string
}

export interface RecordStripePaymentResult {
  ok: boolean
  alreadyPaid?: boolean
  invoiceNumber?: string
}

// Record a settled Stripe payment against an invoice — the SAME invoice.pay
// action the attorney's "Mark paid" uses (method='stripe'). Idempotent: a
// duplicate webhook delivery hits the handler's "already marked paid" guard
// (serialised by its advisory lock) and is reported as ok/alreadyPaid, so the
// webhook can safely return 200.
export async function recordStripePayment(
  args: RecordStripePaymentArgs,
): Promise<RecordStripePaymentResult> {
  const ctx: ActionContext = {
    tenantId: args.tenantId,
    actorId: process.env.LEGAL_PAYMENTS_ACTOR_ID ?? SYSTEM_ACTOR,
  }
  const amount = (args.amountCents / 100).toFixed(2)
  // Structural idempotency: if the invoice is already paid, this is a duplicate
  // delivery (Stripe is at-least-once) — ack WITHOUT depending on the handler's
  // error wording. The string check below stays as a backstop for the concurrent
  // race (two deliveries serialized by invoice.pay's advisory lock).
  const currentStatus = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ v: string | null }>(
      `SELECT a.value #>> '{}' AS v
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'invoice_status'
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY a.valid_from DESC LIMIT 1`,
      [ctx.tenantId, args.invoiceEntityId],
    )
    return r.rows[0]?.v ?? null
  })
  if (currentStatus === 'paid') return { ok: true, alreadyPaid: true }
  try {
    const res = await submitAction(ctx, {
      actionKindName: 'invoice.pay',
      intentKind: 'automatic_sync',
      payload: {
        invoice_entity_id: args.invoiceEntityId,
        method: 'stripe',
        amount,
        currency: args.currency.toUpperCase(),
        reference: args.paymentIntentId,
        note: 'Online payment (Stripe)',
      },
    })
    const effect = (res.effects[0] ?? {}) as { invoiceNumber?: string }
    return { ok: true, invoiceNumber: effect.invoiceNumber }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/already marked paid/i.test(msg)) return { ok: true, alreadyPaid: true }
    throw e
  }
}

// Cross-tenant lookup (superuser) of which firm owns a connected account — needed
// for account.updated, whose event carries no tenant. payment_succeeded never
// needs this: it carries tenant_id in the PaymentIntent metadata.
async function resolveTenantByStripeAccount(accountId: string): Promise<string | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ tenant_id: string }>(
      `SELECT a.tenant_id
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE akd.kind_name = 'stripe_connected_account_id'
          AND a.value #>> '{}' = $1
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY a.valid_from DESC LIMIT 1`,
      [accountId],
    )
    return res.rows[0]?.tenant_id ?? null
  })
}

export interface StripeWebhookResult {
  ok: boolean
  status: number
  error?: string
  handled?: string
  invoiceNumber?: string
  alreadyPaid?: boolean
}

// The vertical's Stripe webhook entry point (the route is a thin pass-through,
// mirroring handleEsignCallback / handleGranolaWebhook). Verifies the signature,
// then: payment_intent.succeeded → record the payment on its invoice (idempotent);
// account.updated → refresh the firm's capability flags. Anything else is acked
// with 200 so Stripe stops retrying. A bad signature returns 400.
export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
): Promise<StripeWebhookResult> {
  let event: Awaited<ReturnType<typeof interpretWebhookEvent>>
  try {
    event = await interpretWebhookEvent(rawBody, signature)
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : 'invalid webhook' }
  }

  if (event.type === 'payment_succeeded') {
    // No metadata → not an invoice we created an intent for; ack and move on.
    if (!event.invoiceEntityId || !event.tenantId) {
      return { ok: true, status: 200, handled: 'payment_succeeded:unattributed' }
    }
    const res = await recordStripePayment({
      invoiceEntityId: event.invoiceEntityId,
      tenantId: event.tenantId,
      amountCents: event.amountCents,
      currency: event.currency,
      paymentIntentId: event.paymentIntentId,
    })
    return {
      ok: true,
      status: 200,
      handled: 'payment_succeeded',
      invoiceNumber: res.invoiceNumber,
      alreadyPaid: res.alreadyPaid,
    }
  }

  if (event.type === 'account_updated') {
    const tenantId = await resolveTenantByStripeAccount(event.accountId)
    if (tenantId) {
      await submitAction(
        { tenantId, actorId: process.env.LEGAL_PAYMENTS_ACTOR_ID ?? SYSTEM_ACTOR },
        {
          actionKindName: 'legal.firm.connect_stripe',
          intentKind: 'automatic_sync',
          payload: {
            account_id: event.accountId,
            charges_enabled: event.chargesEnabled,
            details_submitted: event.detailsSubmitted,
          },
        },
      )
    }
    return { ok: true, status: 200, handled: 'account_updated' }
  }

  return { ok: true, status: 200, handled: 'ignored' }
}
