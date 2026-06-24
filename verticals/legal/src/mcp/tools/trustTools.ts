// Trust (IOLTA) MCP tools — the ADR-0024 adapter over the trust api/queries
// (migration 0110). Thin wrappers; all guards (no overdraft, atomic earned
// transfer, full-amount enforcement) live in the handlers. Reads are tenant-
// scoped. The descriptions are prescriptive so the assistant knows WHEN to call
// each.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  depositToTrust,
  disburseFromTrust,
  refundTrust,
  applyTrustToInvoice,
  getClientTrustBalance,
  listClientTrustLedger,
  getTrustReconciliation,
  type TrustDepositInput,
  type TrustDisburseInput,
  type TrustRefundInput,
  type ApplyTrustResult,
  type TrustBalance,
  type TrustLedgerEntry,
  type TrustReconciliation,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

registerTool({
  name: 'legal.trust.deposit',
  description:
    'Record a deposit of client funds into the firm trust (IOLTA) account, on that client’s sub-ledger. Use when a client pays a retainer/advance or other funds to be held in trust. Returns the new trust balance.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      clientEntityId: { type: 'string' },
      amount: { type: 'string', description: 'Decimal string, e.g. "1000.00".' },
      source: { type: 'string', description: 'retainer | advance | settlement | other.' },
      matterEntityId: { type: 'string', description: 'Optional matter tag.' },
      reference: { type: 'string', description: 'Check number, deposit slip, etc.' },
      depositedDate: { type: 'string', description: 'YYYY-MM-DD; defaults to today.' },
    },
    required: ['clientEntityId', 'amount'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await depositToTrust(ctx, input),
} satisfies Tool<TrustDepositInput, { eventId: string; balance: string }>)

registerTool({
  name: 'legal.trust.disburse',
  description:
    'Disburse funds from a client’s trust balance (e.g. paying a third party on the client’s behalf). Rejected if it would overdraw the client’s trust balance. Returns the new balance.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      clientEntityId: { type: 'string' },
      amount: { type: 'string' },
      payee: { type: 'string' },
      reason: { type: 'string' },
      matterEntityId: { type: 'string' },
      reference: { type: 'string' },
    },
    required: ['clientEntityId', 'amount'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await disburseFromTrust(ctx, input),
} satisfies Tool<TrustDisburseInput, { eventId: string; balance: string }>)

registerTool({
  name: 'legal.trust.refund',
  description:
    'Refund a client’s remaining (unearned) trust balance back to the client. Rejected if it exceeds their balance. Returns the new balance.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      clientEntityId: { type: 'string' },
      amount: { type: 'string' },
      reference: { type: 'string' },
    },
    required: ['clientEntityId', 'amount'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await refundTrust(ctx, input),
} satisfies Tool<TrustRefundInput, { eventId: string; balance: string }>)

registerTool({
  name: 'legal.trust.apply_to_invoice',
  description:
    'Apply a client’s trust funds to one of their ISSUED invoices: moves the earned amount from trust to operating and marks the invoice paid (method=trust). Attorney-initiated. The amount must cover the full invoice and the client must have sufficient trust funds.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceEntityId: { type: 'string' },
      amount: { type: 'string', description: 'Defaults to the full invoice total.' },
    },
    required: ['invoiceEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await applyTrustToInvoice(ctx, input),
} satisfies Tool<{ invoiceEntityId: string; amount?: string | null }, ApplyTrustResult>)

registerTool({
  name: 'legal.trust.balance',
  description: 'Get one client’s current trust (IOLTA) balance.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { clientEntityId: { type: 'string' } },
    required: ['clientEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await getClientTrustBalance(ctx, input.clientEntityId),
} satisfies Tool<{ clientEntityId: string }, TrustBalance>)

registerTool({
  name: 'legal.trust.ledger',
  description:
    'One client’s trust sub-ledger (statement), oldest→newest, with a running balance (roll-forward).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { clientEntityId: { type: 'string' } },
    required: ['clientEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await listClientTrustLedger(ctx, input.clientEntityId),
} satisfies Tool<{ clientEntityId: string }, { entries: TrustLedgerEntry[]; balance: string }>)

registerTool({
  name: 'legal.trust.reconcile',
  description:
    'Three-way trust reconciliation: the firm’s book balance, the per-client breakdown, and every classified break (client overdraft / unassigned funds / bank-vs-book). Pass the bank statement balance to check the third leg.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      bankBalance: {
        type: 'string',
        description: 'The trust bank statement balance, to compare to the book.',
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await getTrustReconciliation(ctx, { bankBalance: input.bankBalance ?? null }),
} satisfies Tool<{ bankBalance?: string | null }, TrustReconciliation>)
