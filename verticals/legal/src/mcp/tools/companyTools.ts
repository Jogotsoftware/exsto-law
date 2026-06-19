import { registerTool, type Tool } from '@exsto/mcp-tools'
import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import { listCompanies, getCompany, type CompanySummary, type CompanyDetail } from '../../index.js'

// CRM around the COMPANY (migration 0067). Company is the account grouping its
// contacts + matters; a company with engagement_status='client' is a client.
// Reads list/get; writes go through the company.* / *.set_company handlers.

registerTool({
  name: 'legal.company.list',
  description:
    'List CRM companies with contact/matter counts, engagement status, and billing settings. Pass onlyClients=true for the Clients tab (companies engaged as clients).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { onlyClients: { type: 'boolean' } },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    companies: await listCompanies(ctx, { onlyClients: input?.onlyClients === true }),
  }),
} satisfies Tool<{ onlyClients?: boolean }, { companies: CompanySummary[] }>)

registerTool({
  name: 'legal.company.get',
  description: "A company's page: its settings, engagement status, contacts, and matters.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { companyEntityId: { type: 'string' } },
    required: ['companyEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    company: await getCompany(ctx, input.companyEntityId),
  }),
} satisfies Tool<{ companyEntityId: string }, { company: CompanyDetail | null }>)

registerTool({
  name: 'legal.company.create',
  description:
    'Create a CRM company (account). Optionally set engagement status (prospect|client|inactive), billing settings, and attach existing contacts/matters.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      company_name: { type: 'string' },
      engagement_status: { type: 'string', enum: ['prospect', 'client', 'inactive'] },
      billable_rate: { type: 'string', description: 'Decimal string, e.g. "350.00".' },
      billing_type: { type: 'string', enum: ['hourly', 'fixed'] },
      main_contact_id: { type: 'string' },
      contact_ids: { type: 'array', items: { type: 'string' } },
      matter_ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['company_name'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await submitAction(ctx, {
      actionKindName: 'company.create',
      intentKind: 'enforcement',
      payload: input,
    }),
} satisfies Tool<Record<string, unknown>, ActionResult>)

registerTool({
  name: 'legal.company.update',
  description:
    'Update a company: engagement status, billing settings (rate, type), or main contact.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      company_entity_id: { type: 'string' },
      engagement_status: { type: 'string', enum: ['prospect', 'client', 'inactive'] },
      billable_rate: { type: 'string' },
      billing_type: { type: 'string', enum: ['hourly', 'fixed'] },
      main_contact_id: { type: 'string' },
    },
    required: ['company_entity_id'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await submitAction(ctx, {
      actionKindName: 'company.update',
      intentKind: 'adjustment',
      payload: input,
    }),
} satisfies Tool<Record<string, unknown>, ActionResult>)

registerTool({
  name: 'legal.contact.set_company',
  description: 'Link a contact to its company (contact_of_company).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      contact_entity_id: { type: 'string' },
      company_entity_id: { type: 'string' },
    },
    required: ['contact_entity_id', 'company_entity_id'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await submitAction(ctx, {
      actionKindName: 'contact.set_company',
      intentKind: 'enforcement',
      payload: input,
    }),
} satisfies Tool<Record<string, unknown>, ActionResult>)

registerTool({
  name: 'legal.matter.set_company',
  description: 'Link a matter to its company (matter_of_company).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matter_entity_id: { type: 'string' },
      company_entity_id: { type: 'string' },
    },
    required: ['matter_entity_id', 'company_entity_id'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await submitAction(ctx, {
      actionKindName: 'matter.set_company',
      intentKind: 'enforcement',
      payload: input,
    }),
} satisfies Tool<Record<string, unknown>, ActionResult>)

registerTool({
  name: 'legal.matter.link_contact',
  description: 'Connect a contact to a matter (matter_contact, many-to-many).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matter_entity_id: { type: 'string' },
      contact_entity_id: { type: 'string' },
    },
    required: ['matter_entity_id', 'contact_entity_id'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    await submitAction(ctx, {
      actionKindName: 'matter.link_contact',
      intentKind: 'enforcement',
      payload: input,
    }),
} satisfies Tool<Record<string, unknown>, ActionResult>)
