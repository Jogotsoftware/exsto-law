// Service Library MCP tools (PR1) — the attorney-admin surface over service
// offerings. WRITE tools go through the action layer (legal.service.upsert /
// legal.service.set_active). NONE of these belong in CLIENT_PORTAL_TOOLS: the
// public booking page uses legal.service.list (active-only) only; service
// editing is attorney-only (clientPolicy.ts is default-deny, so leaving them out
// is sufficient — do not add them there).
import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  createService,
  getDocumentTemplate,
  getDraftingPrompt,
  getQuestionnaire,
  listServicesIncludingInactive,
  serviceCompleteness,
  setServiceActive,
  updateDocumentTemplate,
  updateDraftingPrompt,
  updateQuestionnaire,
  updateServiceMetadata,
  type CreateServiceInput,
  type DocumentTemplateDoc,
  type DraftingPromptDoc,
  type QuestionnaireDoc,
  type ServiceCompleteness,
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
    'Enable or disable a service offering without writing a new version. Enabling is gated on completeness: a service with no questionnaire — or an auto-route service missing a drafting prompt for any document kind — cannot be enabled (the call throws explaining what is missing). Disabling is always allowed. Disabled services disappear from the public booking page but their definition persists.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    setServiceActive(ctx, input.serviceKey, input.active),
}

// Completeness check (PR4). READ — lets the attorney UI gate the "Enable service"
// button and show exactly what is still missing before an enable would succeed.
// Attorney-only: NOT in CLIENT_PORTAL_TOOLS (clientPolicy.ts is default-deny).
const completenessTool: Tool<{ serviceKey: string }, ServiceCompleteness> = {
  name: 'legal.service.completeness',
  description:
    'Check whether a service offering is complete enough to enable (book). Returns { serviceKey, ready, missing }: ready is true only when the service has a questionnaire and — for auto-route services — for every document kind both a drafting prompt with all required slots and a resolvable body template (a bundled one for operating_agreement/engagement_letter, or one authored in-app for novel kinds). missing lists the human-readable reasons it is not yet enableable.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => serviceCompleteness(ctx, input.serviceKey),
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

// Drafting-prompt editor (PR3). Per-document-kind prompt. Read resolves the
// in-app config first, else the bundled repo prompt, else null. Write validates
// the FIXED mustache-slot contract and saves a new immutable version of the
// service with the edited prompt patched into transitions.drafting.prompts. The
// drafting worker (generateDraft) reads the same resolution. NEITHER is
// client-portal-callable (clientPolicy.ts is default-deny): drafting prompts are
// attorney-only configuration.
const promptGetTool: Tool<
  { serviceKey: string; documentKind: string },
  { prompt: DraftingPromptDoc | null }
> = {
  name: 'legal.service.prompt.get',
  description:
    "Get a service offering's drafting prompt for one document kind (e.g. operating_agreement, engagement_letter). Returns the in-app config prompt if saved, otherwise the bundled repo prompt, otherwise null. Includes the required mustache slots and the prompt's source/version.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    prompt: await getDraftingPrompt(ctx, input.serviceKey, input.documentKind),
  }),
}

const promptUpdateTool: Tool<
  { serviceKey: string; documentKind: string; promptText: string },
  { prompt: DraftingPromptDoc }
> = {
  name: 'legal.service.prompt.update',
  description:
    "Save a service offering's drafting prompt for one document kind. Validates that all required mustache slots are present, then writes a NEW immutable version (the prior definition is sealed) and bumps the prompt version. The drafting worker uses the new prompt immediately.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    prompt: await updateDraftingPrompt(ctx, input.serviceKey, input.documentKind, input.promptText),
  }),
}

// Document-template editor (Doc-Types PR1). Per-document-kind BODY template. Read
// resolves the in-app config template first, else the bundled repo body, else null
// (source 'none') for a novel kind not yet authored. Write validates non-empty and
// saves a new immutable version of the service with the template patched into
// transitions.document_templates. The drafting worker (generateDraft) reads the same
// resolution. NEITHER is client-portal-callable (clientPolicy.ts is default-deny):
// document templates are attorney-only configuration.
const templateGetTool: Tool<
  { serviceKey: string; documentKind: string },
  { template: DocumentTemplateDoc | null }
> = {
  name: 'legal.service.template.get',
  description:
    "Get a service offering's document body template for one document kind (e.g. operating_agreement, engagement_letter, or a novel kind like non_disclosure_agreement). Returns the in-app config template if saved, otherwise the bundled repo body for the two built-in kinds, otherwise null/source 'none'. Includes the template's source and version.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    template: await getDocumentTemplate(ctx, input.serviceKey, input.documentKind),
  }),
}

const templateUpdateTool: Tool<
  { serviceKey: string; documentKind: string; templateText: string },
  { template: DocumentTemplateDoc }
> = {
  name: 'legal.service.template.update',
  description:
    "Save a service offering's document body template for one document kind. Validates the template is non-empty, then writes a NEW immutable version (the prior definition is sealed) and bumps the template version. This is what lets a brand-new document type be drafted with no code change. The drafting worker uses the new template immediately.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    template: await updateDocumentTemplate(
      ctx,
      input.serviceKey,
      input.documentKind,
      input.templateText,
    ),
  }),
}

registerTool(listAllTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(setActiveTool)
registerTool(completenessTool)
registerTool(questionnaireGetTool)
registerTool(questionnaireUpdateTool)
registerTool(promptGetTool)
registerTool(promptUpdateTool)
registerTool(templateGetTool)
registerTool(templateUpdateTool)
