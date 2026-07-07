// Manual payment methods (migration 0115) — Zelle + crypto wallets, the
// instruct-then-verify rails alongside Stripe (0113). Writes go THROUGH THE CORE
// via submitAction (vertical rule); reads use withActionContext, tenant-scoped,
// latest-valid (exsto-query-substrate).
//
// Three surfaces:
//   • FIRM (attorney): get/set the config (Settings → Payments), list the
//     client-reported payments awaiting verification, dismiss a bogus report.
//     Confirming a report is the EXISTING invoice.pay action — this module never
//     marks anything paid itself.
//   • CLIENT (portal): read the methods to display on /portal/pay/<invoice>, and
//     report a payment they made (method + verification reference + optional
//     screenshot), authorized against the client's OWN invoice.
//   • The report is an invoice.payment_reported EVENT — a claim, not a state
//     change; the invoice stays due until the attorney verifies.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { getClientInvoiceByNumber } from '../queries/clientBilling.js'

export interface CryptoWallet {
  label: string
  currency: string
  network: string
  address: string
}

export interface ManualPaymentMethods {
  zelle: { recipient: string; recipientName: string } | null
  wallets: CryptoWallet[]
}

const EMPTY_METHODS: ManualPaymentMethods = { zelle: null, wallets: [] }

// ── Firm config (read/write) ──────────────────────────────────────────────────

/** The firm's configured manual payment methods; empty config if never set. */
export async function getManualPaymentMethods(ctx: ActionContext): Promise<ManualPaymentMethods> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ value: unknown }>(
      `SELECT a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         JOIN entity e ON e.id = a.entity_id
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
        WHERE a.tenant_id = $1
          AND akd.kind_name = 'manual_payment_methods_config'
          AND ekd.kind_name = 'firm_settings'
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY a.valid_from DESC
        LIMIT 1`,
      [ctx.tenantId],
    )
    return resolveMethods(res.rows[0]?.value)
  })
}

// Defensive shape resolution (the handler validates writes, but a legacy or
// hand-seeded row must still render as SOMETHING, not crash the payment page).
function resolveMethods(raw: unknown): ManualPaymentMethods {
  if (!raw || typeof raw !== 'object') return EMPTY_METHODS
  const cfg = raw as Record<string, unknown>
  const z =
    cfg.zelle && typeof cfg.zelle === 'object' ? (cfg.zelle as Record<string, unknown>) : null
  const zelle =
    z && typeof z.recipient === 'string' && z.recipient
      ? {
          recipient: z.recipient,
          recipientName: typeof z.recipientName === 'string' ? z.recipientName : '',
        }
      : null
  const wallets = (Array.isArray(cfg.wallets) ? cfg.wallets : [])
    .map((w) => {
      const o = w && typeof w === 'object' ? (w as Record<string, unknown>) : {}
      return {
        label: typeof o.label === 'string' ? o.label : '',
        currency: typeof o.currency === 'string' ? o.currency : '',
        network: typeof o.network === 'string' ? o.network : '',
        address: typeof o.address === 'string' ? o.address : '',
      }
    })
    .filter((w) => w.address && w.currency)
  return { zelle, wallets }
}

/** Save the firm's manual payment methods (the handler validates + bounds). */
export async function setManualPaymentMethods(
  ctx: ActionContext,
  config: ManualPaymentMethods,
): Promise<ManualPaymentMethods> {
  await submitAction(ctx, {
    actionKindName: 'legal.firm.set_manual_payment_methods',
    intentKind: 'adjustment',
    payload: { config: config as unknown as Record<string, unknown> },
  })
  return getManualPaymentMethods(ctx)
}

// ── Client-side: methods to display + report a payment ───────────────────────

// What the payment page needs — currently identical to the firm config (Zelle
// recipient + wallet addresses are payment identities, meant to be shown), but a
// separate function so client exposure stays a deliberate choice.
export async function getClientPaymentMethods(ctx: ActionContext): Promise<ManualPaymentMethods> {
  return getManualPaymentMethods(ctx)
}

export interface ReportInvoicePaymentInput {
  // Stamped by the authed portal route from the session cookie.
  clientContactId: string
  invoiceNumber: string
  method: 'zelle' | 'crypto'
  /** Zelle confirmation number or crypto transaction hash — the verification handle. */
  reference: string
  payerName?: string | null
  note?: string | null
  /** Which configured wallet the client says they paid to (label/currency), for crypto. */
  wallet?: { label?: string | null; currency?: string | null } | null
  /** Storage object key of the uploaded proof screenshot (server-issued by the upload route). */
  screenshotKey?: string | null
}

const REPORT_METHODS = new Set(['zelle', 'crypto'])

/**
 * Record a client's payment claim as an invoice.payment_reported event. The
 * invoice is authorized to the signed-in client via the SAME client-safe read the
 * portal invoice page uses; an invoice that isn't theirs is indistinguishable from
 * one that doesn't exist. The action actor stays the public-intake system actor
 * (ADR 0035) with the client identity in the payload — mirrors clientFeedback.
 */
export async function reportInvoicePayment(
  ctx: ActionContext,
  input: ReportInvoicePaymentInput,
): Promise<{ eventId: string }> {
  const invoiceNumber = (input.invoiceNumber ?? '').trim()
  const method = (input.method ?? '').trim() as ReportInvoicePaymentInput['method']
  const reference = (input.reference ?? '').trim()
  const payerName = (input.payerName ?? '').trim()
  const note = (input.note ?? '').trim()
  const screenshotKey = (input.screenshotKey ?? '').trim()

  if (!REPORT_METHODS.has(method)) throw new Error('Pick how you paid (Zelle or crypto).')
  if (reference.length < 4 || reference.length > 160) {
    throw new Error(
      method === 'crypto'
        ? 'Paste the transaction ID (hash) from your wallet — the firm needs it to verify the payment.'
        : 'Enter the Zelle confirmation number from your banking app.',
    )
  }
  if (payerName.length > 80) throw new Error('That name is too long.')
  if (note.length > 500) throw new Error('That note is too long (max 500 characters).')
  // The key is server-issued by the portal screenshot route; anything else (or a
  // path outside this tenant's payment-reports prefix) is rejected, so a report
  // can never point the attorney's download at another tenant's object.
  if (screenshotKey && !screenshotKey.startsWith(`payment-reports/${ctx.tenantId}/`)) {
    throw new Error('Invalid screenshot reference.')
  }

  const invoice = await getClientInvoiceByNumber(ctx, input.clientContactId, invoiceNumber)
  if (!invoice) throw new Error('Invoice not found.')
  if (invoice.status === 'paid') {
    throw new Error(`Invoice ${invoice.invoiceNumber} is already marked paid — nothing to report.`)
  }

  const wallet =
    method === 'crypto' && input.wallet
      ? {
          label: typeof input.wallet.label === 'string' ? input.wallet.label.slice(0, 40) : '',
          currency:
            typeof input.wallet.currency === 'string' ? input.wallet.currency.slice(0, 12) : '',
        }
      : null

  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'reflection',
    payload: {
      event_kind_name: 'invoice.payment_reported',
      primary_entity_id: invoice.invoiceEntityId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        invoice_number: invoice.invoiceNumber,
        method,
        reference,
        payer_name: payerName || null,
        note: note || null,
        wallet,
        screenshot_key: screenshotKey || null,
        client_contact_id: input.clientContactId,
      },
    },
  })
  const eventId = (res.effects[0] as { eventId?: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

// ── Attorney side: list + dismiss reports ─────────────────────────────────────

export interface PaymentReport {
  eventId: string
  invoiceEntityId: string
  invoiceNumber: string
  /** Live invoice status — 'paid' means someone already confirmed it. */
  invoiceStatus: string
  method: 'zelle' | 'crypto'
  reference: string
  payerName: string | null
  note: string | null
  wallet: { label: string; currency: string } | null
  screenshotKey: string | null
  reportedAt: string
  /** 'open' needs attorney action; 'resolved' = invoice since paid; 'dismissed'. */
  status: 'open' | 'resolved' | 'dismissed'
  dismissedReason: string | null
}

/**
 * All client payment reports, newest first, with each report's disposition:
 * open (verify or dismiss), resolved (the invoice has since been paid), or
 * dismissed (an invoice.payment_report_dismissed correction references it).
 */
export async function listPaymentReports(ctx: ActionContext): Promise<PaymentReport[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      invoice_entity_id: string
      payload: {
        invoice_number?: string
        method?: string
        reference?: string
        payer_name?: string | null
        note?: string | null
        wallet?: { label?: string; currency?: string } | null
        screenshot_key?: string | null
      }
      occurred_at: string
      invoice_status: string | null
      dismissed_reason: string | null
      dismissed: boolean
    }>(
      `SELECT e.id AS event_id,
              e.primary_entity_id AS invoice_entity_id,
              e.payload,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS occurred_at,
              (SELECT a.value #>> '{}'
                 FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                WHERE a.tenant_id = e.tenant_id
                  AND a.entity_id = e.primary_entity_id
                  AND akd.kind_name = 'invoice_status'
                  AND (a.valid_to IS NULL OR a.valid_to > now())
                ORDER BY a.valid_from DESC
                LIMIT 1) AS invoice_status,
              (SELECT d.payload->>'reason'
                 FROM event d
                 JOIN event_kind_definition dkd ON dkd.id = d.event_kind_id
                WHERE d.tenant_id = e.tenant_id
                  AND dkd.kind_name = 'invoice.payment_report_dismissed'
                  AND d.payload->>'report_event_id' = e.id::text
                ORDER BY d.occurred_at DESC
                LIMIT 1) AS dismissed_reason,
              EXISTS (
                SELECT 1
                  FROM event d
                  JOIN event_kind_definition dkd ON dkd.id = d.event_kind_id
                 WHERE d.tenant_id = e.tenant_id
                   AND dkd.kind_name = 'invoice.payment_report_dismissed'
                   AND d.payload->>'report_event_id' = e.id::text
              ) AS dismissed
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'invoice.payment_reported'
       ORDER BY e.occurred_at DESC
       LIMIT 200`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => {
      const p = r.payload ?? {}
      const status: PaymentReport['status'] = r.dismissed
        ? 'dismissed'
        : r.invoice_status === 'paid'
          ? 'resolved'
          : 'open'
      return {
        eventId: r.event_id,
        invoiceEntityId: r.invoice_entity_id,
        invoiceNumber: p.invoice_number ?? '',
        invoiceStatus: r.invoice_status ?? 'unknown',
        method: p.method === 'crypto' ? 'crypto' : 'zelle',
        reference: p.reference ?? '',
        payerName: p.payer_name ?? null,
        note: p.note ?? null,
        wallet:
          p.wallet && p.wallet.currency
            ? { label: p.wallet.label ?? '', currency: p.wallet.currency }
            : null,
        screenshotKey: p.screenshot_key ?? null,
        reportedAt: r.occurred_at,
        status,
        dismissedReason: r.dismissed_reason,
      }
    })
  })
}

/**
 * Dismiss a payment report the attorney could not verify (or that is duplicate /
 * mistaken). Append-only correction: a new event referencing the report; the
 * report itself stays in history.
 */
export async function dismissPaymentReport(
  ctx: ActionContext,
  input: { reportEventId: string; reason?: string | null },
): Promise<{ eventId: string }> {
  const reportEventId = (input.reportEventId ?? '').trim()
  if (!reportEventId) throw new Error('reportEventId is required.')
  const reason = (input.reason ?? '').trim().slice(0, 300)

  // The report must exist in THIS tenant (RLS scopes the read; a foreign or
  // bogus id fails identically) — and carry the invoice so the dismissal
  // threads on the same entity timeline.
  const report = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string; primary_entity_id: string }>(
      `SELECT e.id, e.primary_entity_id
         FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'invoice.payment_reported'`,
      [ctx.tenantId, reportEventId],
    )
    return r.rows[0] ?? null
  })
  if (!report) throw new Error('Payment report not found.')

  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'correction',
    payload: {
      event_kind_name: 'invoice.payment_report_dismissed',
      primary_entity_id: report.primary_entity_id,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: { report_event_id: reportEventId, reason: reason || null },
    },
  })
  const eventId = (res.effects[0] as { eventId?: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}
