import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getClientMatterTimeline,
  listClientMatters,
  getMatterThread,
  postClientMessage,
  listClientInvoices,
  getClientInvoiceByNumber,
  quoteClientRequest,
  createClientRequest,
  listClientRequests,
  submitClientPortalFeedback,
  isRequestType,
  type ClientMatterTimeline,
  type ClientMatterListItem,
  type PortalMessage,
  type ClientInvoiceSummary,
  type ClientInvoiceDetail,
  type RequestQuote,
  type RequestType,
  type ClientRequestSummary,
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

registerTool(matterTimelineTool)
registerTool(mattersTool)
registerTool(threadGetTool)
registerTool(messagePostTool)
registerTool(invoicesTool)
registerTool(invoiceGetTool)
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

registerTool(requestQuoteTool)
registerTool(requestCreateTool)
registerTool(requestListTool)
registerTool(feedbackSubmitTool)
