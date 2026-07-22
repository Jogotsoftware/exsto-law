import { registerTool, type Tool } from '@exsto/mcp-tools'
import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import {
  listClients,
  getClient,
  resolveClientMatterEntityIds,
  listDocumentsForMatters,
  getHistoryForMatters,
  type ClientSummary,
  type ClientDetail,
  type PersonDocumentItem,
  type MatterHistory,
} from '../../index.js'

// Clients CRM (beta sprint Obj 2/3). Client is the parent grouping its contacts
// and matters; reads list/get, writes go through the legal.client.* handlers.

registerTool({
  name: 'legal.client.list',
  description:
    'List clients with their contact and matter counts and billing settings. The Clients CRM list.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ clients: await listClients(ctx) }),
} satisfies Tool<Record<string, never>, { clients: ClientSummary[] }>)

registerTool({
  name: 'legal.client.get',
  description: "A client's page: its settings, attached contacts, and matters.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { clientEntityId: { type: 'string' } },
    required: ['clientEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    client: await getClient(ctx, input.clientEntityId),
  }),
} satisfies Tool<{ clientEntityId: string }, { client: ClientDetail | null }>)

// Client detail — Documents tab: every document across all the client's matters
// (generated + uploaded). Named documents_all so it never shadows the portal
// client-facing legal.client.documents; attorney-only (not in the client allowlist).
registerTool({
  name: 'legal.client.documents_all',
  description:
    "Every document across all of a client's matters (generated drafts + uploaded files), newest first, tagged by matter.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { clientEntityId: { type: 'string' } },
    required: ['clientEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const matterIds = await resolveClientMatterEntityIds(ctx, input.clientEntityId)
    return { documents: await listDocumentsForMatters(ctx, matterIds) }
  },
} satisfies Tool<{ clientEntityId: string }, { documents: PersonDocumentItem[] }>)

// Client detail — Activity tab: audit/timeline aggregated across the client's matters.
registerTool({
  name: 'legal.client.activity',
  description: "All activity (actions + events) across a client's matters, for the Activity tab.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { clientEntityId: { type: 'string' } },
    required: ['clientEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const matterIds = await resolveClientMatterEntityIds(ctx, input.clientEntityId)
    return { history: await getHistoryForMatters(ctx, matterIds) }
  },
} satisfies Tool<{ clientEntityId: string }, { history: MatterHistory }>)

registerTool({
  name: 'legal.client.create',
  description:
    'Create a client (parent) and optionally attach existing contacts/matters and set billing settings.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      client_name: { type: 'string' },
      billable_rate: { type: 'string', description: 'Decimal string, e.g. "350.00".' },
      billing_type: { type: 'string', enum: ['hourly', 'fixed'] },
      website: { type: 'string', description: "The client's own website (URL or bare domain)." },
      main_contact_id: { type: 'string' },
      contact_ids: { type: 'array', items: { type: 'string' } },
      matter_ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['client_name'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await submitAction(ctx, {
      actionKindName: 'legal.client.create',
      intentKind: 'enforcement',
      payload: input,
    }),
} satisfies Tool<Record<string, unknown>, ActionResult>)

registerTool({
  name: 'legal.client.update',
  description:
    'Update a client: billing settings (rate, billing type), main contact, name, or attach a contact/matter.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      client_entity_id: { type: 'string' },
      client_name: { type: 'string' },
      billable_rate: { type: 'string' },
      billing_type: { type: 'string', enum: ['hourly', 'fixed'] },
      website: {
        type: 'string',
        description: "The client's own website (URL or bare domain). An empty string clears it.",
      },
      main_contact_id: { type: 'string' },
      attach_contact_id: { type: 'string' },
      attach_matter_id: { type: 'string' },
    },
    required: ['client_entity_id'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await submitAction(ctx, {
      actionKindName: 'legal.client.update',
      intentKind: 'adjustment',
      payload: input,
    }),
} satisfies Tool<Record<string, unknown>, ActionResult>)
