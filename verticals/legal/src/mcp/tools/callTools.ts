import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listCallsForMatter,
  listCallsForContact,
  listUnmatchedCalls,
  type CallSummary,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Calls / meetings read surface (beta sprint Obj 8). A matter page and a contact
// page each list their consultation calls; the review queue lists ingested calls
// not yet attached to a matter. Each call carries its Granola summary (the
// call_notes object) and transcript so the UI can render them clickable.

const forMatterTool: Tool<{ matterEntityId: string }, { calls: CallSummary[] }> = {
  name: 'legal.call.list_for_matter',
  description:
    "Calls and meetings recorded against a matter, newest first, each with its Granola summary and transcript. Powers the matter page's Calls section.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string', description: 'The matter entity id.' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    calls: await listCallsForMatter(ctx, input.matterEntityId),
  }),
}

const forContactTool: Tool<{ contactEntityId: string }, { calls: CallSummary[] }> = {
  name: 'legal.call.list_for_contact',
  description:
    "Calls and meetings associated with a contact across every matter they're on, newest first, each with its Granola summary and transcript. Powers the contact page's Calls section.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { contactEntityId: { type: 'string', description: 'The contact entity id.' } },
    required: ['contactEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    calls: await listCallsForContact(ctx, input.contactEntityId),
  }),
}

const unmatchedTool: Tool<Record<string, never>, { calls: CallSummary[] }> = {
  name: 'legal.call.list_unmatched',
  description:
    'Ingested calls not yet attached to any matter — the review queue. Each carries its Granola summary and transcript so the attorney can route it.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ calls: await listUnmatchedCalls(ctx) }),
}

registerTool(forMatterTool)
registerTool(forContactTool)
registerTool(unmatchedTool)
