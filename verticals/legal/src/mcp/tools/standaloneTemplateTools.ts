import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listStandaloneTemplates,
  getStandaloneTemplate,
  createTemplate,
  updateTemplate,
  archiveTemplate,
  aiDraftTemplate,
  type StandaloneTemplate,
  type CreateTemplateInput,
  type UpdateTemplateInput,
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

registerTool(listTool)
registerTool(getTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(archiveTool)
registerTool(aiDraftTool)
