// Service Library MCP tools (PR1) — the attorney-admin surface over service
// offerings. WRITE tools go through the action layer (legal.service.upsert /
// legal.service.set_active). NONE of these belong in CLIENT_PORTAL_TOOLS: the
// public booking page uses legal.service.list (active-only) only; service
// editing is attorney-only (clientPolicy.ts is default-deny, so leaving them out
// is sufficient — do not add them there).
import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  createService,
  listServicesIncludingInactive,
  setServiceActive,
  updateServiceMetadata,
  type CreateServiceInput,
  type ServiceDefinition,
  type UpdateServiceMetadataInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const listAllTool: Tool<Record<string, never>, { services: ServiceDefinition[] }> = {
  name: 'legal.service.list_all',
  description:
    'List ALL service offerings for the attorney admin, including disabled ones (booking page uses legal.service.list, which is active-only).',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ services: await listServicesIncludingInactive(ctx) }),
}

const createTool: Tool<CreateServiceInput, { service: ServiceDefinition }> = {
  name: 'legal.service.create',
  description:
    'Create a new service offering (metadata only — name, description, route, documents, sort order). Versioned config: this is version 1 of a new workflow_definition.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({ service: await createService(ctx, input) }),
}

const updateTool: Tool<UpdateServiceMetadataInput, { service: ServiceDefinition }> = {
  name: 'legal.service.update',
  description:
    'Update a service offering’s metadata. Saves a NEW immutable version: the prior active definition is sealed and version+1 is inserted, preserving the intake-form binding and workflow route unless overridden.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    service: await updateServiceMetadata(ctx, input),
  }),
}

const setActiveTool: Tool<
  { serviceKey: string; active: boolean },
  { serviceKey: string; status: string }
> = {
  name: 'legal.service.set_active',
  description:
    'Enable or disable a service offering without writing a new version. Disabled services disappear from the public booking page but their definition persists.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    setServiceActive(ctx, input.serviceKey, input.active),
}

registerTool(listAllTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(setActiveTool)
