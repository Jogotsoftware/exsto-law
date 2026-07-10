import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getClientMatterTimeline,
  listClientMatters,
  getMatterThread,
  postClientMessage,
  listClientInvoices,
  getClientInvoiceByNumber,
  createInvoicePaymentIntent,
  type InvoicePaymentIntentResult,
  quoteClientRequest,
  createClientRequest,
  listClientRequests,
  submitClientPortalFeedback,
  renderClientInvoicePdfBase64,
  listApprovedClientDocuments,
  listClientUploadedDocuments,
  isRequestType,
  type InvoicePdf,
  type ApprovedClientDocument,
  type ClientUploadedDocument,
  type ClientMatterTimeline,
  type ClientMatterListItem,
  type PortalMessage,
  type ClientInvoiceSummary,
  type ClientInvoiceDetail,
  type RequestQuote,
  type RequestType,
  type ClientRequestSummary,
  getClientPaymentMethods,
  reportInvoicePayment,
  type ManualPaymentMethods,
  getClientBillingSummary,
  listClientTodos,
  type ClientBillingSummary,
  type ClientTodo,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// AUTHENTICATED client-portal tools. These are reachable ONLY through the authed
// route (/api/client/portal/mcp) — they are in CLIENT_PORTAL_AUTHED_TOOLS, NOT
// the public CLIENT_PORTAL_TOOLS allowlist. Both are read-mode.
//
// Trust boundary: clientContactId and matterEntityId arrive on `input`, but the
// ROUTE stamps them from the verified session cookie — the route also asserts
// matterEntityId ∈ session.matterIds BEFORE dispatch. These handlers therefore
// trust ctx (tenant) + the stamped fields; they never read identity from a body
// the client controls. (ctx.actorId is the public-intake system actor; client
// identity lives on client_contact — ADR 0035.)

interface TimelineInput {
  matterEntityId: string
}

const matterTimelineTool: Tool<TimelineInput, { timeline: ClientMatterTimeline | null }> = {
  name: 'legal.client.matter_timeline',
  description:
    "Client-safe status + milestone timeline for one of the signed-in client's own matters.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    timeline: await getClientMatterTimeline(ctx, input.matterEntityId),
  }),
}

interface MattersInput {
  // Stamped by the authed route from the session cookie's clientContactId.
  clientContactId: string
}

const mattersTool: Tool<MattersInput, { matters: ClientMatterListItem[] }> = {
  name: 'legal.client.matters',
  description: 'List the matters the signed-in client is associated with (the matter switcher).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    matters: await listClientMatters(ctx, input.clientContactId),
  }),
}

// ── Messaging (PR2) ─────────────────────────────────────────────────────────
// Both arrive via the authed route, which stamps clientContactId from the cookie
// and asserts matterEntityId ∈ session.matterIds BEFORE dispatch. These handlers
// therefore trust the stamped fields; the client identity on a posted message is
// the client_contact ENTITY (ADR 0035), never the action's actor.

interface ThreadGetInput {
  matterEntityId: string
}

const threadGetTool: Tool<ThreadGetInput, { messages: PortalMessage[] }> = {
  name: 'legal.client.thread_get',
  description:
    "Read the message thread between the signed-in client and the attorney for one of the client's own matters.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    messages: await getMatterThread(ctx, input.matterEntityId),
  }),
}

interface MessagePostInput {
  matterEntityId: string
  body: string
  // Stamped by the authed route from the session cookie's clientContactId.
  clientContactId: string
}

const messagePostTool: Tool<MessagePostInput, { posted: boolean }> = {
  name: 'legal.client.message_post',
  description: "Post a message to the attorney on one of the signed-in client's own matters.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await postClientMessage(ctx, {
      matterEntityId: input.matterEntityId,
      body: input.body,
      clientContactId: input.clientContactId,
    })
    return { posted: true }
  },
}

// ── Invoices (view) ─────────────────────────────────────────────────────────
// Client-safe: scoped to the signed-in client's own matters, issued/sent/paid
// only (never a draft), public fields only (no rates, source events, or notes).
// clientContactId is stamped by the authed route from the session cookie.

interface InvoicesInput {
  clientContactId: string
}

const invoicesTool: Tool<InvoicesInput, { invoices: ClientInvoiceSummary[] }> = {
  name: 'legal.client.invoices',
  description: "List the signed-in client's invoices (number, total, status, dates).",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    invoices: await listClientInvoices(ctx, input.clientContactId),
  }),
}

interface InvoiceGetInput {
  invoiceNumber: string
  clientContactId: string
}

const invoiceGetTool: Tool<InvoiceGetInput, { invoice: ClientInvoiceDetail | null }> = {
  name: 'legal.client.invoice_get',
  description:
    "Fetch one of the signed-in client's own invoices by number, with line descriptions + amounts.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    invoice: await getClientInvoiceByNumber(ctx, input.clientContactId, input.invoiceNumber),
  }),
}

const invoicePdfTool: Tool<InvoiceGetInput, { pdf: InvoicePdf | null }> = {
  name: 'legal.client.invoice_pdf',
  description:
    "Render one of the signed-in client's own invoices to a branded PDF (base64). Client-safe: no rates, quantities, matter numbers, or notes — descriptions + amounts only.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    pdf: await renderClientInvoicePdfBase64(ctx, input.clientContactId, input.invoiceNumber),
  }),
}

// ── Requests (cost-gated self-serve) ─────────────────────────────────────────
// quote = price only (no write); create = the client accepted the price (write).
// The route stamps clientContactId and asserts matterEntityId ∈ session.matterIds.

interface RequestQuoteInput {
  requestType: RequestType
  durationMinutes?: number | null
}

const requestQuoteTool: Tool<RequestQuoteInput, { quote: RequestQuote }> = {
  name: 'legal.client.request_quote',
  description:
    'Get the price for a client request type (meeting, document, review) before submitting it.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    if (!isRequestType(input.requestType)) throw new Error('Unknown request type.')
    return {
      quote: await quoteClientRequest(ctx, {
        requestType: input.requestType,
        durationMinutes: input.durationMinutes ?? null,
      }),
    }
  },
}

interface RequestCreateInput {
  matterEntityId: string
  requestType: RequestType
  durationMinutes?: number | null
  description?: string | null
  // Stamped by the authed route from the session cookie's clientContactId.
  clientContactId: string
}

const requestCreateTool: Tool<RequestCreateInput, { requestId: string; quote: RequestQuote }> = {
  name: 'legal.client.request_create',
  description:
    'Create a client request on one of the client’s own matters after they accept the quoted price.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    if (!isRequestType(input.requestType)) throw new Error('Unknown request type.')
    return createClientRequest(ctx, {
      clientContactId: input.clientContactId,
      matterEntityId: input.matterEntityId,
      requestType: input.requestType,
      durationMinutes: input.durationMinutes ?? null,
      description: input.description ?? null,
    })
  },
}

// Begin an online payment for ONE of the signed-in client's own invoices. Reads
// nothing the client can't already see (it authorises through the same client-safe
// invoice read) and writes nothing to the substrate — it opens a Stripe
// PaymentIntent on the firm's connected account and returns the client secret the
// embedded Payment Element needs. The settled payment is recorded later by the
// Stripe webhook (invoice.pay), not here. clientContactId is stamped by the route.
interface InvoicePaymentIntentInput {
  invoiceNumber: string
  clientContactId: string
}

const invoicePaymentIntentTool: Tool<InvoicePaymentIntentInput, InvoicePaymentIntentResult> = {
  name: 'legal.client.invoice_payment_intent',
  description:
    "Begin an online card/bank payment for one of the signed-in client's own invoices; returns the Stripe client secret for the embedded payment form (or an unavailable reason).",
  mode: 'read',
  handler: async (ctx: ActionContext, input) =>
    createInvoicePaymentIntent(ctx, input.clientContactId, input.invoiceNumber),
}

interface RequestListInput {
  clientContactId: string
}

const requestListTool: Tool<RequestListInput, { requests: ClientRequestSummary[] }> = {
  name: 'legal.client.request_list',
  description: "List the signed-in client's own requests and their status.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    requests: await listClientRequests(ctx, input.clientContactId),
  }),
}

interface DocumentsInput {
  clientContactId: string
}

const documentsTool: Tool<DocumentsInput, { documents: ApprovedClientDocument[] }> = {
  name: 'legal.client.documents',
  description:
    "List the attorney-approved documents on the signed-in client's matters (view each via the shared-draft page).",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    documents: await listApprovedClientDocuments(ctx, input.clientContactId),
  }),
}

const uploadsTool: Tool<DocumentsInput, { documents: ClientUploadedDocument[] }> = {
  name: 'legal.client.uploads',
  description: 'List the documents the signed-in client has uploaded (metadata only).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    documents: await listClientUploadedDocuments(ctx, input.clientContactId),
  }),
}

// ── Feedback (the portal chat widget) ────────────────────────────────────────
// Client leaves feedback ABOUT the portal; recorded into the same triage channel
// as attorney beta feedback (tagged client/client_portal). clientContactId is
// stamped by the authed route. Pure capture — no model call, no matter context.
interface FeedbackInput {
  message: string
  category?: string | null
  pageContext?: Record<string, unknown> | null
  clientContactId: string
}

const feedbackSubmitTool: Tool<FeedbackInput, { eventId: string }> = {
  name: 'legal.client.feedback_submit',
  description: 'Submit the signed-in client’s feedback about the portal (the portal chat widget).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    submitClientPortalFeedback(ctx, {
      clientContactId: input.clientContactId,
      message: input.message,
      category: input.category ?? null,
      pageContext: input.pageContext ?? null,
    }),
}

// ── Manual payment methods (Zelle + crypto, migration 0115) ─────────────────
// The instruct-then-verify rails: the pay page shows the firm's Zelle recipient
// and wallet addresses, the client pays in their own app, then REPORTS it here
// with a verification reference. The invoice stays due until the attorney
// verifies and marks it paid — the report is a claim, never a state change.
const paymentMethodsTool: Tool<Record<string, never>, { methods: ManualPaymentMethods }> = {
  name: 'legal.client.payment_methods',
  description:
    "The firm's manual payment options (Zelle recipient, crypto wallet addresses) to display on the invoice payment page.",
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ methods: await getClientPaymentMethods(ctx) }),
}

interface ReportPaymentInput {
  invoiceNumber: string
  method: 'zelle' | 'crypto'
  reference: string
  payerName?: string | null
  note?: string | null
  wallet?: { label?: string | null; currency?: string | null } | null
  screenshotKey?: string | null
  clientContactId: string
}

const reportPaymentTool: Tool<ReportPaymentInput, { eventId: string }> = {
  name: 'legal.client.report_payment',
  description:
    'Report a Zelle/crypto payment the signed-in client made on one of their OWN invoices (confirmation number / transaction hash + optional proof screenshot). The firm verifies before the invoice is marked paid. clientContactId is stamped by the route.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    reportInvoicePayment(ctx, {
      clientContactId: input.clientContactId,
      invoiceNumber: input.invoiceNumber,
      method: input.method,
      reference: input.reference,
      payerName: input.payerName ?? null,
      note: input.note ?? null,
      wallet: input.wallet ?? null,
      screenshotKey: input.screenshotKey ?? null,
    }),
}

// PORTAL-1 (WP2) — Billing: invoices + accruing not-yet-invoiced fees + running
// total, computed from the SAME source as the attorney's billing panel.
const billingSummaryTool: Tool<{ clientContactId: string }, { billing: ClientBillingSummary }> = {
  name: 'legal.client.billing_summary',
  description:
    "Per-matter billing for the signed-in client: invoices (open + paid), accrued not-yet-invoiced fees (recorded ledger events only — never estimates), and a running total.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    billing: await getClientBillingSummary(ctx, input.clientContactId),
  }),
}

// PORTAL-1 (WP2) — Things to do: sign / pay / materials-requested in one list.
const todosTool: Tool<{ clientContactId: string }, { todos: ClientTodo[] }> = {
  name: 'legal.client.todos',
  description:
    "Everything waiting on the signed-in client: documents to sign, invoices to pay, materials the firm requested.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    todos: await listClientTodos(ctx, input.clientContactId),
  }),
}

registerTool(billingSummaryTool)
registerTool(todosTool)
registerTool(matterTimelineTool)
registerTool(mattersTool)
registerTool(threadGetTool)
registerTool(messagePostTool)
registerTool(invoicesTool)
registerTool(invoiceGetTool)
registerTool(invoicePdfTool)
registerTool(invoicePaymentIntentTool)
registerTool(requestQuoteTool)
registerTool(requestCreateTool)
registerTool(requestListTool)
registerTool(documentsTool)
registerTool(uploadsTool)
registerTool(feedbackSubmitTool)
registerTool(paymentMethodsTool)
registerTool(reportPaymentTool)
