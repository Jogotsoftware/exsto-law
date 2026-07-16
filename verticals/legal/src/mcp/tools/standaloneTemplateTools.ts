import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listStandaloneTemplates,
  getStandaloneTemplate,
  createTemplate,
  updateTemplate,
  archiveTemplate,
  retireTemplate,
  aiDraftTemplate,
  aiEnhanceTemplate,
  loadFirmFieldLibrary,
  listServicesIncludingInactive,
  MERGE_SLOT_FIELDS,
  type StandaloneTemplate,
  type CreateTemplateInput,
  type UpdateTemplateInput,
  type AiEnhanceTemplateInput,
  type FirmQuestionSummary,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Standalone templates (beta sprint Obj 9) — the firm's reusable document/email
// templates not bound to any service. The Templates tab lists them via the
// aggregate catalog; these tools drive the standalone editor (create/edit/archive).
// Attorney-only (not in CLIENT_PORTAL_TOOLS; clientPolicy.ts is default-deny).

const listTool: Tool<Record<string, never>, { templates: StandaloneTemplate[] }> = {
  name: 'legal.template.list',
  description:
    "List the firm's standalone (not service-bound) templates — reusable document and email templates. Each includes its category, body, and optional document-kind tag.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ templates: await listStandaloneTemplates(ctx) }),
}

// The firm-wide field catalog the template editors bind against: every
// questionnaire field id any current service defines (with the services that
// define it), the merge engine's curated slot ids, and each service's document
// kinds. The docKind map is what lets the library editor decide ASSOCIATION —
// blue only when the field's question lives in a questionnaire of a service
// that produces this template's document kind; merely-existing fields are
// yellow. Read-only; composes loadFirmFieldLibrary (which recurses repeater
// memberFields), MERGE_SLOT_FIELDS, and listServicesIncludingInactive.
const fieldLibraryTool: Tool<
  Record<string, never>,
  {
    firmFields: FirmQuestionSummary[]
    mergeFields: string[]
    serviceDocuments: Array<{ serviceKey: string; documents: string[] }>
  }
> = {
  name: 'legal.template.field_library',
  description:
    "The firm-wide template field catalog: every questionnaire field id defined by any service (with the defining service keys), the platform merge slots (matter facts, fee block, firm identity, dates), and each service's document kinds. Editors bind {{tokens}} blue when the field's questionnaire is associated with the document, yellow when the field merely exists.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => {
    const services = await listServicesIncludingInactive(ctx)
    return {
      firmFields: await loadFirmFieldLibrary(ctx, ''),
      mergeFields: [...MERGE_SLOT_FIELDS],
      serviceDocuments: services.map((s) => ({
        serviceKey: s.serviceKey,
        documents: s.documents ?? [],
      })),
    }
  },
}

const getTool: Tool<{ templateEntityId: string }, { template: StandaloneTemplate | null }> = {
  name: 'legal.template.get',
  description: 'Fetch one standalone template (name, category, body, document-kind tag).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { templateEntityId: { type: 'string' } },
    required: ['templateEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    template: await getStandaloneTemplate(ctx, input.templateEntityId),
  }),
}

const createTool: Tool<CreateTemplateInput, { template: StandaloneTemplate }> = {
  name: 'legal.template.create',
  description:
    "Create a standalone template: category 'document' or 'email', a name, and the body (markdown/text, may contain {{tokens}}). Optionally tag a document template with a documentKind (e.g. nda).",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      category: { type: 'string', enum: ['document', 'email'] },
      body: { type: 'string' },
      docKind: { type: 'string', description: 'Optional document-kind tag (document only).' },
      variables: {
        type: 'object',
        description:
          'Optional typed metadata per {{token}}, keyed by token id: { type, required, default, options }.',
        additionalProperties: true,
      },
      signature: {
        type: 'object',
        description:
          "Signability declaration: { required: boolean, signer_roles: ('client'|'attorney'|'witness'|'notary')[] }. Omit for an unsigned document (the default). Declaring required: true is what lets the workflow builder compose an e-signature step after this document's drafting step.",
        properties: {
          required: { type: 'boolean' },
          signer_roles: {
            type: 'array',
            items: { type: 'string', enum: ['client', 'attorney', 'witness', 'notary'] },
          },
        },
        additionalProperties: false,
      },
    },
    required: ['name', 'category', 'body'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ template: await createTemplate(ctx, input) }),
}

const updateTool: Tool<UpdateTemplateInput, { template: StandaloneTemplate }> = {
  name: 'legal.template.update',
  description:
    'Update a standalone template (name / body / document-kind tag). Append-only: a new attribute version supersedes the prior.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      templateEntityId: { type: 'string' },
      name: { type: 'string' },
      body: { type: 'string' },
      docKind: { type: 'string' },
      variables: {
        type: 'object',
        description:
          'Optional typed metadata per {{token}}, keyed by token id: { type, required, default, options }. A provided map (including {}) supersedes the prior.',
        additionalProperties: true,
      },
      signature: {
        type: 'object',
        description:
          "Signability declaration: { required: boolean, signer_roles: ('client'|'attorney'|'witness'|'notary')[] }. A provided declaration supersedes the prior; { required: false } unsigns.",
        properties: {
          required: { type: 'boolean' },
          signer_roles: {
            type: 'array',
            items: { type: 'string', enum: ['client', 'attorney', 'witness', 'notary'] },
          },
        },
        additionalProperties: false,
      },
    },
    required: ['templateEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ template: await updateTemplate(ctx, input) }),
}

const archiveTool: Tool<
  { templateEntityId: string },
  { templateEntityId: string; archived: true }
> = {
  name: 'legal.template.archive',
  description:
    'Archive a standalone template (status archived — kept as history, dropped from active listings). Append-only via the core entity.archive.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { templateEntityId: { type: 'string' } },
    required: ['templateEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => archiveTemplate(ctx, input.templateEntityId),
}

// HARDENING-RESIDUALS-1 (WP-F): soft retire, mirroring legal.service.retire.
// Unlike archive, retire REFUSES while the template is attached to an active
// service's workflow or fed by a questionnaire — the error names the holder so
// the attorney detaches there first. Existing document drafts are untouched.
const retireTool: Tool<{ templateEntityId: string }, { templateEntityId: string; retired: true }> =
  {
    name: 'legal.template.retire',
    description:
      'Retire a standalone template: it leaves the Templates library and every picker while history and existing document drafts stay untouched. Blocked with "in use by X" while an active service workflow or questionnaire still references it — detach there first.',
    mode: 'write',
    inputSchema: {
      type: 'object',
      properties: { templateEntityId: { type: 'string' } },
      required: ['templateEntityId'],
      additionalProperties: false,
    },
    handler: async (ctx: ActionContext, input) => retireTemplate(ctx, input.templateEntityId),
  }

// AI draft (Templates wizard). Generates a template body from a plain-language
// description using the firm's Anthropic key. Returns text only — the attorney
// reviews it in the editor and SAVES via create/update (that's the recorded write),
// so this is a read-mode generation with no substrate mutation.
const aiDraftTool: Tool<
  {
    instructions: string
    category: 'document' | 'email'
    skillSlugs?: string[]
    modelId?: string
  },
  { body: string }
> = {
  name: 'legal.template.ai_draft',
  description:
    'Draft a reusable template body from a plain-language description, using the firm’s Settings-managed Anthropic key. Optionally force specific legal skills (skillSlugs) and choose the model (modelId). Returns the body text (with {{merge_tokens}}) for the attorney to review and save — it does not persist anything itself.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      instructions: {
        type: 'string',
        description: 'Plain-language description of the template to draft.',
      },
      category: { type: 'string', enum: ['document', 'email'] },
      skillSlugs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional legal-skill slugs to force-load as drafting guidance.',
      },
      modelId: {
        type: 'string',
        description:
          "Optional model id from legal.assistant.models, e.g. 'anthropic:claude-haiku-4-5-20251001'. Defaults to the firm default.",
      },
    },
    required: ['instructions', 'category'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => aiDraftTemplate(ctx, input),
}

const aiEnhanceTool: Tool<AiEnhanceTemplateInput, { body: string }> = {
  name: 'legal.template.ai_enhance',
  description:
    'Revise an EXISTING template body (or draft fresh when it is empty) using the firm’s Settings-managed Anthropic key — preserving the {{merge_tokens}} already in it and reusing the bound questionnaire’s fields (fieldIds) for fill-ins. Optionally force specific legal skills (skillSlugs) and choose the model (modelId). Returns the revised body for the attorney to review and save — it persists nothing itself.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      currentBody: {
        type: 'string',
        description:
          'The current template body to improve. Empty string ⇒ draft from instructions.',
      },
      instructions: {
        type: 'string',
        description: 'What to change. Omit for a general polish/tighten pass.',
      },
      category: { type: 'string', enum: ['document', 'email'] },
      fieldIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Questionnaire field ids to reuse as {{tokens}} for fill-ins.',
      },
      skillSlugs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional legal-skill slugs to force-load as drafting guidance.',
      },
      modelId: {
        type: 'string',
        description:
          "Optional model id from legal.assistant.models, e.g. 'anthropic:claude-haiku-4-5-20251001'. Defaults to the firm default.",
      },
    },
    required: ['currentBody', 'category'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => aiEnhanceTemplate(ctx, input),
}

registerTool(listTool)
registerTool(fieldLibraryTool)
registerTool(getTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(archiveTool)
registerTool(retireTool)
registerTool(aiDraftTool)
registerTool(aiEnhanceTool)
