import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  issueInvoice,
  sendInvoice,
  payInvoice,
  listUnbilled,
  listInvoices,
  listMatterInvoiced,
  getInvoice,
  getRatesView,
  setClientRate,
  setServiceRate,
  completeService,
  addMatterFee,
  voidMatterFee,
  getInvoiceTemplate,
  setInvoiceTemplate,
  renderInvoicePdfBase64,
  renderInvoiceTemplatePreviewBase64,
  type AddMatterFeeInput,
  type CompleteServiceResult,
  type InvoiceTemplateConfig,
  type InvoicePdf,
  type IssueInvoiceInput,
  type IssuedInvoice,
  type SendInvoiceInput,
  type SentInvoice,
  type PayInvoiceInput,
  type PaidInvoice,
  type UnbilledClient,
  type InvoiceSummary,
  type InvoiceDetail,
  type MatterInvoicedItem,
  type RatesView,
  getManualPaymentMethods,
  setManualPaymentMethods,
  listPaymentReports,
  dismissPaymentReport,
  type ManualPaymentMethods,
  type PaymentReport,
  listFeeConsentTrail,
  type FeeConsentTrailEntry,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Billing surface (Session 4): roll the unbilled time.logged / expense.recorded
// ledger events up into invoices, list/inspect invoices, and send them. Reads are
// derived (unbilled = ledger events with no *.billed event); writes go through the
// invoice.issue / invoice.send action handlers.

registerTool({
  name: 'legal.billing.unbilled',
  description:
    'List all unbilled time + expense ledger entries, grouped by client then matter, with computed line amounts and totals (the invoice-generation worklist).',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => await listUnbilled(ctx),
} satisfies Tool<Record<string, never>, { clients: UnbilledClient[]; currency: string }>)

registerTool({
  name: 'legal.matter.fee_consents',
  description:
    'PORTAL-1 (WP3): the client fee-consent trail for one matter — every fee.quoted / fee.accepted / fee.declined event, newest first — rendered next to the fees it authorized.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    consents: await listFeeConsentTrail(ctx, input.matterEntityId),
  }),
} satisfies Tool<{ matterEntityId: string }, { consents: FeeConsentTrailEntry[] }>)

registerTool({
  name: 'legal.billing.matter_invoiced',
  description:
    'List the already-invoiced (billed) line items for one matter, each with its invoice number and status — the counterpart to the unbilled feed for a matter Billing tab.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await listMatterInvoiced(ctx, input.matterEntityId),
} satisfies Tool<{ matterEntityId: string }, { items: MatterInvoicedItem[]; currency: string }>)

registerTool({
  name: 'legal.invoice.list',
  description: 'List issued invoices (newest first) with status, client, total, and line count.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ invoices: await listInvoices(ctx) }),
} satisfies Tool<Record<string, never>, { invoices: InvoiceSummary[] }>)

registerTool({
  name: 'legal.invoice.get',
  description:
    'Get one invoice with its lines (each line references its source time/expense entry).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { invoiceEntityId: { type: 'string' } },
    required: ['invoiceEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    invoice: await getInvoice(ctx, input.invoiceEntityId),
  }),
} satisfies Tool<{ invoiceEntityId: string }, { invoice: InvoiceDetail | null }>)

registerTool({
  name: 'legal.invoice.issue',
  description:
    'Issue an invoice from selected unbilled time + expense entries for a client (optionally one matter). Creates the invoice + lines, marks each source entry billed, and issues it.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      clientEntityId: { type: 'string' },
      matterEntityId: { type: 'string', description: 'Optional: scope the invoice to one matter.' },
      currency: { type: 'string', description: 'ISO currency; defaults USD.' },
      dueDate: { type: 'string', description: 'ISO date YYYY-MM-DD (optional).' },
      notes: { type: 'string', description: 'Optional note shown on the invoice.' },
      lines: {
        type: 'array',
        description: 'The unbilled entries to bill.',
        items: {
          type: 'object',
          properties: {
            sourceEventId: {
              type: 'string',
              description:
                'Id of the time.logged / expense.recorded / service_fee.recorded / document_fee.recorded event.',
            },
            kind: { type: 'string', enum: ['time', 'expense', 'service_fee', 'document_fee'] },
            rateOverride: {
              type: 'string',
              description: 'Per-line rate override (decimal string); time only.',
            },
            descriptionOverride: { type: 'string' },
          },
          required: ['sourceEventId', 'kind'],
          additionalProperties: false,
        },
      },
    },
    required: ['clientEntityId', 'lines'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await issueInvoice(ctx, input),
} satisfies Tool<IssueInvoiceInput, IssuedInvoice>)

registerTool({
  name: 'legal.invoice.send',
  description:
    'Email an issued invoice to the client (amounts + a "Pay now" link to the portal) through the firm\'s Gmail, and record invoice.sent through the core. Requires Google to be connected; throws a clear error if it is not.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceEntityId: { type: 'string' },
      toEmail: {
        type: 'string',
        description: 'Recipient override; defaults to the client main-contact email.',
      },
      message: { type: 'string', description: 'Optional cover line added under the greeting.' },
      payUrlBase: {
        type: 'string',
        description:
          'App origin for the "Pay now" link (e.g. https://app.pacheco.law); the link is `${payUrlBase}/portal/pay/<invoiceNumber>`. Pass window.location.origin from the browser.',
      },
    },
    required: ['invoiceEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await sendInvoice(ctx, input),
} satisfies Tool<SendInvoiceInput, SentInvoice>)

registerTool({
  name: 'legal.invoice.pay',
  description:
    'Record a payment against an issued or sent invoice: marks it paid (invoice_status=paid) and emits invoice.paid through the core. v1 is a manual mark-paid; a payment processor can call this same path later. Errors clearly if the invoice is not issued/sent or is already paid.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceEntityId: { type: 'string' },
      method: {
        type: 'string',
        description:
          "Payment method, e.g. 'manual', 'check', 'transfer', or a processor name. Defaults to 'manual'.",
      },
      amount: { type: 'string', description: 'Decimal string; defaults to the invoice total.' },
      reference: { type: 'string', description: 'Check number, processor charge id, etc.' },
      paidDate: { type: 'string', description: 'YYYY-MM-DD; defaults to today.' },
      note: { type: 'string' },
    },
    required: ['invoiceEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await payInvoice(ctx, input),
} satisfies Tool<PayInvoiceInput, PaidInvoice>)

// ── Flat fees (Phase 2) ───────────────────────────────────────────────────────
// Document fees accrue automatically on document approval and service fees on
// service completion; these tools cover the manual + completion edges.

registerTool({
  name: 'legal.service.complete',
  description:
    "Mark a matter's service workflow complete, accruing the service's flat fee (if configured) as a billable entry. Idempotent per matter + service.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await completeService(ctx, input.matterEntityId),
} satisfies Tool<{ matterEntityId: string }, CompleteServiceResult>)

registerTool({
  name: 'legal.matter.add_fee',
  description:
    "Add a service or document fee to a matter by hand (decimal string, ADR 0044). Becomes a billable line in the matter's Unbilled list.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      feeType: { type: 'string', enum: ['service', 'document'] },
      amount: { type: 'string', description: 'Decimal string, e.g. "250.00".' },
      description: { type: 'string' },
      documentKind: { type: 'string', description: 'For a document fee: the document kind label.' },
    },
    required: ['matterEntityId', 'feeType', 'amount'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await addMatterFee(ctx, input),
} satisfies Tool<
  AddMatterFeeInput,
  { eventId: string; matterEntityId: string; feeType: string; amount: string }
>)

registerTool({
  name: 'legal.matter.void_fee',
  description:
    'Void an unbilled service or document fee on a matter (records billing_entry.voided naming its ledger event). Fails if the fee is already invoiced.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { sourceEventId: { type: 'string' } },
    required: ['sourceEventId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await voidMatterFee(ctx, input.sourceEventId),
} satisfies Tool<
  { sourceEventId: string },
  { eventId: string; sourceEventId: string; voided: boolean }
>)

// ── Invoice PDF + template (Phase 3) ──────────────────────────────────────────
// One renderer (billing/invoicePdf.ts) feeds the view, download, email attachment,
// and the Settings live preview, so a real branded PDF is the single artifact.

registerTool({
  name: 'legal.invoice.pdf',
  description:
    'Render an issued invoice to a real PDF (base64) using the firm\'s invoice template. Powers the "view"/"download" actions; returns null if the invoice is not found.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { invoiceEntityId: { type: 'string' } },
    required: ['invoiceEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    pdf: await renderInvoicePdfBase64(ctx, input.invoiceEntityId),
  }),
} satisfies Tool<{ invoiceEntityId: string }, { pdf: InvoicePdf | null }>)

registerTool({
  name: 'legal.firm.get_invoice_template',
  description:
    "The firm's invoice template branding/content config (firm name/address/phone, logo, accent color, visible columns, header note, payment instructions), resolved over defaults.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ template: await getInvoiceTemplate(ctx) }),
} satisfies Tool<Record<string, never>, { template: InvoiceTemplateConfig }>)

registerTool({
  name: 'legal.firm.set_invoice_template',
  description:
    "Save the firm's invoice template branding/content config. Partial configs are merged over defaults. Effective-dated (the prior config stays in history).",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { config: { type: 'object', additionalProperties: true } },
    required: ['config'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    template: await setInvoiceTemplate(ctx, input.config),
  }),
} satisfies Tool<{ config: Partial<InvoiceTemplateConfig> }, { template: InvoiceTemplateConfig }>)

registerTool({
  name: 'legal.invoice.template_preview',
  description:
    'Render a SAMPLE invoice to a PDF (base64) with a draft template config — the Settings editor live preview, no save.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { config: { type: 'object', additionalProperties: true } },
    required: ['config'],
    additionalProperties: false,
  },
  handler: async (_ctx: ActionContext, input) => ({
    pdf: await renderInvoiceTemplatePreviewBase64(input.config),
  }),
} satisfies Tool<{ config: Partial<InvoiceTemplateConfig> }, { pdf: InvoicePdf }>)

// ── Rates management (Contract K) ─────────────────────────────────────────────
// One source of truth for the three rate scopes (rates.ts). The Rates tab reads
// the view and writes per-client / per-service rates; the firm default has its
// own pair (legal.firm.get/set_default_rate in settingsTools).

registerTool({
  name: 'legal.rates.view',
  description:
    'The billing Rates view: the firm default hourly rate, every client with its own rate + effective rate (own ?? firm default), and every service with its fixed fee. Powers the Rates tab.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => await getRatesView(ctx),
} satisfies Tool<Record<string, never>, RatesView>)

registerTool({
  name: 'legal.rates.set_client',
  description:
    'Set a client\'s billable hourly rate (decimal string, ADR 0044, e.g. "350.00"). Routes through legal.client.update so the rate has one writer; appended effective-dated.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      clientEntityId: { type: 'string' },
      rate: { type: 'string', description: 'Decimal string, e.g. "350.00".' },
    },
    required: ['clientEntityId', 'rate'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await setClientRate(ctx, input.clientEntityId, input.rate),
} satisfies Tool<{ clientEntityId: string; rate: string }, { rate: string }>)

registerTool({
  name: 'legal.rates.set_service',
  description:
    "Set a service's fixed fee (decimal string, ADR 0044). Routes through legal.service.upsert so the fee is the service config's fixed_fee — one source; the service's other config is preserved.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      serviceKey: { type: 'string' },
      fixedFee: { type: 'string', description: 'Decimal string, e.g. "1500.00".' },
    },
    required: ['serviceKey', 'fixedFee'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await setServiceRate(ctx, input.serviceKey, input.fixedFee),
} satisfies Tool<{ serviceKey: string; fixedFee: string }, { fixedFee: string }>)

// ── Manual payment methods — Zelle + crypto (migration 0115) ──────────────────
// The firm's instruct-then-verify rails: config lives on firm_settings; client
// payment claims arrive as invoice.payment_reported events. Confirming a report
// is the EXISTING legal.invoice.pay tool (method 'zelle'/'crypto' + reference) —
// these tools only configure, list, and dismiss.

registerTool({
  name: 'legal.firm.get_payment_methods',
  description:
    "The firm's manual payment methods (Zelle recipient + crypto wallet addresses) shown to clients on the invoice payment page.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ methods: await getManualPaymentMethods(ctx) }),
} satisfies Tool<Record<string, never>, { methods: ManualPaymentMethods }>)

registerTool({
  name: 'legal.firm.set_payment_methods',
  description:
    "Save the firm's manual payment methods: Zelle recipient (enrolled email/phone + display name) and up to 10 crypto wallets (label, currency, network, address). Shown to clients as pay-by-instruction options on the invoice payment page.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      config: {
        type: 'object',
        properties: {
          // No `type` on purpose: null (don't offer Zelle) or the object below —
          // the schema type here only takes a single string, and the handler
          // validates the shape anyway.
          zelle: {
            description:
              "The firm's Zelle recipient ({recipient, recipientName}) or null to not offer Zelle.",
          },
          wallets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                currency: { type: 'string', description: 'e.g. BTC, ETH, USDC.' },
                network: { type: 'string', description: 'e.g. Bitcoin, Ethereum mainnet, Solana.' },
                address: { type: 'string' },
              },
              required: ['currency', 'address'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    required: ['config'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    methods: await setManualPaymentMethods(ctx, input.config as ManualPaymentMethods),
  }),
} satisfies Tool<{ config: ManualPaymentMethods }, { methods: ManualPaymentMethods }>)

registerTool({
  name: 'legal.billing.payment_reports',
  description:
    'Client-reported Zelle/crypto payments awaiting verification (plus recently resolved/dismissed ones). Verify against your bank app / a block explorer / the screenshot, then confirm with legal.invoice.pay or dismiss with legal.billing.dismiss_payment_report.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ reports: await listPaymentReports(ctx) }),
} satisfies Tool<Record<string, never>, { reports: PaymentReport[] }>)

registerTool({
  name: 'legal.billing.dismiss_payment_report',
  description:
    'Dismiss a client payment report you could not verify (or that is duplicate/mistaken). Append-only: records a correction event; the report stays in history.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      reportEventId: { type: 'string' },
      reason: { type: 'string', description: 'Why it was dismissed (shown alongside the report).' },
    },
    required: ['reportEventId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await dismissPaymentReport(ctx, input),
} satisfies Tool<{ reportEventId: string; reason?: string | null }, { eventId: string }>)
