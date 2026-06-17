import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  logTimeEntry,
  listMatterTime,
  recordExpense,
  listMatterExpenses,
  getExpenseReceipt,
  type LogTimeInput,
  type MatterTime,
  type RecordExpenseInput,
  type MatterExpenses,
  type ReceiptUpload,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Matter time & expense ledgers. Writes record a time.logged / expense.recorded
// event on the matter timeline (through event.record); reads return the entries
// plus a total. Receipt bytes are fetched on demand to keep lists lean.

registerTool({
  name: 'legal.time.log',
  description:
    'Log billable time against a matter (duration in minutes + description, optional worked date). Records a time.logged event on the matter timeline.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      durationMinutes: { type: 'number', description: 'Whole minutes worked (> 0).' },
      description: { type: 'string' },
      workedDate: { type: 'string', description: 'ISO date YYYY-MM-DD; defaults to today.' },
    },
    required: ['matterEntityId', 'durationMinutes', 'description'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await logTimeEntry(ctx, input),
} satisfies Tool<LogTimeInput, { eventId: string }>)

registerTool({
  name: 'legal.time.list',
  description: 'List time entries for a matter (newest first) with the total minutes.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await listMatterTime(ctx, input.matterEntityId),
} satisfies Tool<{ matterEntityId: string }, MatterTime>)

registerTool({
  name: 'legal.expense.record',
  description:
    'Record a matter expense (amount as a decimal string like "150.00", description, optional receipt upload + incurred date). Records an expense.recorded event.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      amount: { type: 'string', description: 'Decimal string, e.g. "150.00".' },
      currency: { type: 'string', description: 'ISO currency; defaults to USD.' },
      description: { type: 'string' },
      incurredDate: { type: 'string', description: 'ISO date YYYY-MM-DD; defaults to today.' },
      receipt: {
        type: 'object',
        description: 'Optional receipt file (small; held inline as base64).',
        properties: {
          filename: { type: 'string' },
          contentType: { type: 'string' },
          dataBase64: { type: 'string' },
        },
        required: ['filename', 'contentType', 'dataBase64'],
        additionalProperties: false,
      },
    },
    required: ['matterEntityId', 'amount', 'description'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await recordExpense(ctx, input),
} satisfies Tool<RecordExpenseInput, { eventId: string }>)

registerTool({
  name: 'legal.expense.list',
  description:
    'List expenses for a matter (newest first) with the total. Receipt metadata only — fetch bytes via legal.expense.receipt.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await listMatterExpenses(ctx, input.matterEntityId),
} satisfies Tool<{ matterEntityId: string }, MatterExpenses>)

registerTool({
  name: 'legal.expense.receipt',
  description:
    "Fetch one expense's receipt bytes (filename, contentType, base64) for download. Returns null when there is no receipt.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      eventId: { type: 'string' },
    },
    required: ['matterEntityId', 'eventId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ receipt: await getExpenseReceipt(ctx, input) }),
} satisfies Tool<{ matterEntityId: string; eventId: string }, { receipt: ReceiptUpload | null }>)
