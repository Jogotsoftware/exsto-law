// Service Library MCP tools (PR1) — the attorney-admin surface over service
// offerings. WRITE tools go through the action layer (legal.service.upsert /
// legal.service.set_active). NONE of these belong in CLIENT_PORTAL_TOOLS: the
// public booking page uses legal.service.list (active-only) only; service
// editing is attorney-only (clientPolicy.ts is default-deny, so leaving them out
// is sufficient — do not add them there).
import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  createService,
  getQuestionnaire,
  listServicesIncludingInactive,
  setServiceActive,
  updateQuestionnaire,
  updateServiceMetadata,
  type CreateServiceInput,
  type QuestionnaireDoc,
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

// Questionnaire editor (PR2). Read returns the resolved intake form (in-app config
// first, else the bound repo file, else null). Write saves a new immutable version
// of the service with the edited schema patched into transitions.intake_schema.
// NEITHER is client-portal-callable (clientPolicy.ts is default-deny): the public
// booking page reads schemas via legal.service.list only.
const questionnaireGetTool: Tool<
  { serviceKey: string },
  { questionnaire: QuestionnaireDoc | null }
> = {
  name: 'legal.service.questionnaire.get',
  description:
    "Get a service offering's intake questionnaire for editing. Returns the in-app config if one has been saved, otherwise the bound repo-file form, otherwise null.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    questionnaire: await getQuestionnaire(ctx, input.serviceKey),
  }),
}

const questionnaireUpdateTool: Tool<
  { serviceKey: string; intakeSchema: unknown },
  { questionnaire: QuestionnaireDoc }
> = {
  name: 'legal.service.questionnaire.update',
  description:
    "Save a service offering's intake questionnaire. Validates the schema shape and field types, then writes a NEW immutable version (the prior definition is sealed). The public booking page reads the new form immediately.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    questionnaire: await updateQuestionnaire(ctx, input.serviceKey, input.intakeSchema),
  }),
}

registerTool(listAllTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(setActiveTool)
registerTool(questionnaireGetTool)
registerTool(questionnaireUpdateTool)
