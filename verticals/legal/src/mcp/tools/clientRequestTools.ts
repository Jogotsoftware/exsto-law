import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listPendingRequests,
  acceptClientRequest,
  startClientRequest,
  fulfillClientRequest,
  declineClientRequest,
  type AttorneyRequestItem,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// ATTORNEY-side client-request tools — the inbox of active requests and the
// lifecycle transitions. Attorney-only (never in the client allowlists). Each
// write goes through an action handler; fulfilment also records the accepted
// amount as a matter fee so it rolls into the next invoice.

registerTool({
  name: 'legal.client_request.list_pending',
  description:
    'List active (non-terminal) client requests across the firm — the attorney inbox — with type, accepted price, matter, and client.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ requests: await listPendingRequests(ctx) }),
} satisfies Tool<Record<string, never>, { requests: AttorneyRequestItem[] }>)

const idSchema = {
  type: 'object' as const,
  properties: { requestEntityId: { type: 'string' as const } },
  required: ['requestEntityId'],
  additionalProperties: false,
}

registerTool({
  name: 'legal.client_request.accept',
  description: 'Accept a client request (requested → accepted) and notify the client.',
  mode: 'write',
  inputSchema: idSchema,
  handler: async (ctx: ActionContext, input: { requestEntityId: string }) =>
    await acceptClientRequest(ctx, input.requestEntityId),
} satisfies Tool<{ requestEntityId: string }, { ok: boolean; status: string }>)

registerTool({
  name: 'legal.client_request.start',
  description: 'Mark a client request in progress (accepted → in_progress) and notify the client.',
  mode: 'write',
  inputSchema: idSchema,
  handler: async (ctx: ActionContext, input: { requestEntityId: string }) =>
    await startClientRequest(ctx, input.requestEntityId),
} satisfies Tool<{ requestEntityId: string }, { ok: boolean; status: string }>)

registerTool({
  name: 'legal.client_request.fulfill',
  description:
    'Fulfil a client request (→ fulfilled), record the accepted amount as a matter fee, and notify the client.',
  mode: 'write',
  inputSchema: idSchema,
  handler: async (ctx: ActionContext, input: { requestEntityId: string }) =>
    await fulfillClientRequest(ctx, input.requestEntityId),
} satisfies Tool<{ requestEntityId: string }, { ok: boolean; status: string; billed: boolean }>)

registerTool({
  name: 'legal.client_request.decline',
  description: 'Decline a client request (→ declined), recording no fee, and notify the client.',
  mode: 'write',
  inputSchema: idSchema,
  handler: async (ctx: ActionContext, input: { requestEntityId: string }) =>
    await declineClientRequest(ctx, input.requestEntityId),
} satisfies Tool<{ requestEntityId: string }, { ok: boolean; status: string }>)
