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
  submitAssistantMessageFeedback,
  type TranscriptTurnSnapshot,
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
  getPortalSchedulingAvailability,
  getSchedulingFeeQuote,
  scheduleClientTime,
  SchedulingFeeConsentRequiredError,
  getClientIntakePrefill,
  type PortalSchedulingAvailability,
  type SchedulingFeeQuote,
  type ScheduledTimeResult,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'
import {
  getPortalHomeSummary,
  listClientNotifications,
  markClientNotificationsRead,
  type PortalHomeSummary,
  type PortalNotificationFeed,
  type PortalLocale,
} from '../../index.js'
import {
  acceptEngagement,
  declineEngagement,
  getEngagementConfig,
  getEngagementStatus,
  type EngagementConfig,
  type EngagementStatus,
} from '../../api/engagement.js'

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

// FB-0 — thumbs up/down on ONE assistant-portal reply, with an optional note
// and a snapshot of the whole visible conversation. clientContactId is
// stamped by the authed route (never trusted from the body) and is the ONLY
// scope used — submitAssistantMessageFeedback forces the portal surface onto
// that contact regardless of anything else in `input`, so a client can only
// ever rate their OWN chat.
interface MessageFeedbackInput {
  verdict: 'up' | 'down'
  note?: string | null
  messageEventId?: string | null
  messageIndex: number
  chatSessionId?: string | null
  transcript: TranscriptTurnSnapshot[]
  clientContactId: string
}

const messageFeedbackSubmitTool: Tool<
  MessageFeedbackInput,
  { eventId: string; transcriptBlobId: string }
> = {
  name: 'legal.client.message_feedback_submit',
  description:
    "Record the signed-in client's thumbs up/down on ONE portal-assistant reply, with an optional note, plus a snapshot of the whole visible conversation so far.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    submitAssistantMessageFeedback(ctx, {
      verdict: input.verdict,
      note: input.note ?? null,
      surface: 'portal',
      messageEventId: input.messageEventId ?? null,
      messageIndex: input.messageIndex,
      chatSessionId: input.chatSessionId ?? null,
      transcript: input.transcript,
      clientContactId: input.clientContactId,
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
    'Per-matter billing for the signed-in client: invoices (open + paid), accrued not-yet-invoiced fees (recorded ledger events only — never estimates), and a running total.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    billing: await getClientBillingSummary(ctx, input.clientContactId),
  }),
}

// PORTAL-1 (WP2) — Things to do: sign / pay / materials-requested in one list.
const todosTool: Tool<{ clientContactId: string }, { todos: ClientTodo[] }> = {
  name: 'legal.client.todos',
  description:
    'Everything waiting on the signed-in client: documents to sign, invoices to pay, materials the firm requested.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    todos: await listClientTodos(ctx, input.clientContactId),
  }),
}

// PORTAL-1 (WP4) — schedule time on the firm's REAL availability.
const scheduleAvailabilityTool: Tool<
  { durationMinutes?: number; daysOut?: number },
  { availability: PortalSchedulingAvailability }
> = {
  name: 'legal.client.schedule_availability',
  description:
    'Open consultation slots on the firm’s live calendar (rules ∩ Google free/busy — never fabricated).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    availability: await getPortalSchedulingAvailability(ctx, {
      durationMinutes: input.durationMinutes,
      daysOut: input.daysOut,
    }),
  }),
}

const scheduleQuoteTool: Tool<
  { clientContactId: string; durationMinutes: number },
  { quote: SchedulingFeeQuote | null }
> = {
  name: 'legal.client.schedule_quote',
  description:
    'The fee (rate × duration) for portal-scheduled time when the firm bills it — null when scheduling is free for this client.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    quote: await getSchedulingFeeQuote(ctx, input.clientContactId, input.durationMinutes ?? 30),
  }),
}

interface ScheduleTimeInput {
  clientContactId: string
  startIso: string
  endIso: string
  durationMinutes?: number
  reason?: string | null
  feeAccepted?: boolean
}
const scheduleTimeTool: Tool<
  ScheduleTimeInput,
  { result?: ScheduledTimeResult; feeConsentRequired?: true; quote?: SchedulingFeeQuote }
> = {
  name: 'legal.client.schedule_time',
  description:
    'Book a consultation slot as the signed-in client. Billable time (per the firm’s setting) requires accepting the rate × duration fee first — enforced server-side.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    try {
      const result = await scheduleClientTime(ctx, {
        clientContactId: input.clientContactId,
        startIso: input.startIso,
        endIso: input.endIso,
        durationMinutes: input.durationMinutes,
        reason: input.reason ?? null,
        feeAccepted: input.feeAccepted === true,
      })
      return { result }
    } catch (err) {
      if (err instanceof SchedulingFeeConsentRequiredError) {
        return { feeConsentRequired: true, quote: err.quote }
      }
      throw err
    }
  },
}

// PORTAL-1 (WP4) — prefill a repeat booking from what the firm already knows.
const intakePrefillTool: Tool<
  { clientContactId: string; serviceKey?: string },
  { responses: Record<string, unknown> | null }
> = {
  name: 'legal.client.intake_prefill',
  description:
    "The signed-in client's most recent intake answers (preferring the same service), for prefilled repeat booking. The client edits and confirms before submitting.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    responses: await getClientIntakePrefill(ctx, input.clientContactId, input.serviceKey ?? null),
  }),
}

// ── CLIENT-PORTAL-UI-1 — home summary, notifications, engagement gate ────────
// clientContactId is stamped by the authed route from the session cookie on all
// of these; locale is client-chosen presentation state ('en' | 'es'), nothing
// more — it selects copy from the canonical i18n store, never data.

interface HomeInput {
  clientContactId: string
  locale?: string
}

const homeSummaryTool: Tool<HomeInput, { home: PortalHomeSummary }> = {
  name: 'legal.client.home_summary',
  description:
    "The portal home in one read: the signed-in client's matters, attention items, message/billing previews, unread badge, and engagement-gate state.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    home: await getPortalHomeSummary(
      ctx,
      input.clientContactId,
      input.locale === 'es' ? 'es' : ('en' as PortalLocale),
    ),
  }),
}

interface ContactOnlyInput {
  clientContactId: string
}

const notificationsTool: Tool<ContactOnlyInput, { feed: PortalNotificationFeed }> = {
  name: 'legal.client.notifications',
  description:
    "The signed-in client's notifications feed (what happened, newest first) with the unread watermark applied.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    feed: await listClientNotifications(ctx, input.clientContactId),
  }),
}

const notificationsReadTool: Tool<ContactOnlyInput, { readAt: string }> = {
  name: 'legal.client.notifications_read',
  description:
    'Mark the signed-in client’s notifications as read (append-only watermark — no fact row is updated).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    markClientNotificationsRead(ctx, input.clientContactId),
}

const engagementTool: Tool<
  ContactOnlyInput,
  { status: EngagementStatus; config: EngagementConfig }
> = {
  name: 'legal.client.engagement',
  description:
    'The signed-in client’s engagement-agreement state (accepted?) plus the current firm rate and terms for the gate card.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    status: await getEngagementStatus(ctx, input.clientContactId),
    config: await getEngagementConfig(ctx),
  }),
}

const engagementAcceptTool: Tool<
  ContactOnlyInput,
  { consentEventId: string; rate: string | null; termsVersion: number | null }
> = {
  name: 'legal.client.engagement_accept',
  description:
    'The client’s own actor accepts the firm-level engagement agreement (rate + terms version bound server-side). One-time: messaging and booking unlock.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => acceptEngagement(ctx, input.clientContactId),
}

const engagementDeclineTool: Tool<ContactOnlyInput, { consentEventId: string }> = {
  name: 'legal.client.engagement_decline',
  description: 'The client’s own actor declines the firm-level engagement agreement.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => declineEngagement(ctx, input.clientContactId),
}

registerTool(homeSummaryTool)
registerTool(notificationsTool)
registerTool(notificationsReadTool)
registerTool(engagementTool)
registerTool(engagementAcceptTool)
registerTool(engagementDeclineTool)
registerTool(scheduleAvailabilityTool)
registerTool(scheduleQuoteTool)
registerTool(scheduleTimeTool)
registerTool(intakePrefillTool)
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
registerTool(messageFeedbackSubmitTool)
registerTool(paymentMethodsTool)
registerTool(reportPaymentTool)
