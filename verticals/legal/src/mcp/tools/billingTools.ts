import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  issueInvoice,
  sendInvoice,
  listUnbilled,
  listInvoices,
  getInvoice,
  type IssueInvoiceInput,
  type IssuedInvoice,
  type SendInvoiceInput,
  type SentInvoice,
  type UnbilledClient,
  type InvoiceSummary,
  type InvoiceDetail,
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
  name: 'legal.invoice.list',
  description: 'List issued invoices (newest first) with status, client, total, and line count.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ invoices: await listInvoices(ctx) }),
} satisfies Tool<Record<string, never>, { invoices: InvoiceSummary[] }>)

registerTool({
  name: 'legal.invoice.get',
  description: 'Get one invoice with its lines (each line references its source time/expense entry).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { invoiceEntityId: { type: 'string' } },
    required: ['invoiceEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ invoice: await getInvoice(ctx, input.invoiceEntityId) }),
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
            sourceEventId: { type: 'string', description: 'Id of the time.logged / expense.recorded event.' },
            kind: { type: 'string', enum: ['time', 'expense'] },
            rateOverride: { type: 'string', description: 'Per-line rate override (decimal string); time only.' },
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
    'Send an issued invoice to the client and record invoice.sent through the core. v1 live delivery is activation-gated (Google connect + comms send contract) — the response flags activationGated.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceEntityId: { type: 'string' },
      toEmail: { type: 'string', description: 'Recipient override; defaults to the client main-contact email.' },
      message: { type: 'string', description: 'Optional cover message.' },
    },
    required: ['invoiceEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await sendInvoice(ctx, input),
} satisfies Tool<SendInvoiceInput, SentInvoice>)
