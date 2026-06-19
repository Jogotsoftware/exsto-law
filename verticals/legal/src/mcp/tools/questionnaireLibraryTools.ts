import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listQuestionnaireTemplates,
  getQuestionnaireTemplate,
  createQuestionnaireTemplate,
  updateQuestionnaireTemplate,
  archiveQuestionnaireTemplate,
  type QuestionnaireTemplate,
  type CreateQuestionnaireTemplateInput,
  type UpdateQuestionnaireTemplateInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Questionnaire library (migration 0067) — the firm's reusable, NOT-service-bound
// intake forms, attachable to any service. Mirrors the standalone template tools.
// Attorney-only (not in CLIENT_PORTAL_TOOLS; clientPolicy.ts is default-deny).

// The intake schema is { sections: [{ id, title, fields: [...] }] } — the same
// shape services consume. Left open (additionalProperties) so the builder can
// carry field flags without a schema change here.
const SCHEMA_PROP = {
  type: 'object' as const,
  description: 'The intake schema: { sections: [{ id, title, fields: [...] }] }.',
  properties: {
    sections: {
      type: 'array' as const,
      items: { type: 'object' as const, additionalProperties: true },
    },
  },
  required: ['sections'],
  additionalProperties: true,
}

const listTool: Tool<Record<string, never>, { questionnaires: QuestionnaireTemplate[] }> = {
  name: 'legal.questionnaire_template.list',
  description:
    "List the firm's standalone (not service-bound) questionnaire templates — reusable intake forms. Each includes its name, optional description, field count, and full schema.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({
    questionnaires: await listQuestionnaireTemplates(ctx),
  }),
}

const getTool: Tool<
  { questionnaireTemplateId: string },
  { questionnaire: QuestionnaireTemplate | null }
> = {
  name: 'legal.questionnaire_template.get',
  description: 'Fetch one standalone questionnaire template (name, description, schema).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { questionnaireTemplateId: { type: 'string' } },
    required: ['questionnaireTemplateId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    questionnaire: await getQuestionnaireTemplate(ctx, input.questionnaireTemplateId),
  }),
}

const createTool: Tool<CreateQuestionnaireTemplateInput, { questionnaire: QuestionnaireTemplate }> =
  {
    name: 'legal.questionnaire_template.create',
    description:
      'Create a reusable questionnaire template: a name, optional description, and the intake schema (sections[].fields[]). Lives in the firm library, attachable to any service.',
    mode: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string', description: 'Optional short description.' },
        schema: SCHEMA_PROP,
      },
      required: ['name', 'schema'],
      additionalProperties: false,
    },
    handler: async (ctx: ActionContext, input) => ({
      questionnaire: await createQuestionnaireTemplate(ctx, input),
    }),
  }

const updateTool: Tool<UpdateQuestionnaireTemplateInput, { questionnaire: QuestionnaireTemplate }> =
  {
    name: 'legal.questionnaire_template.update',
    description:
      'Update a reusable questionnaire template (name / description / schema). Append-only: a new attribute version supersedes the prior.',
    mode: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        questionnaireTemplateId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        schema: SCHEMA_PROP,
      },
      required: ['questionnaireTemplateId'],
      additionalProperties: false,
    },
    handler: async (ctx: ActionContext, input) => ({
      questionnaire: await updateQuestionnaireTemplate(ctx, input),
    }),
  }

const archiveTool: Tool<
  { questionnaireTemplateId: string },
  { questionnaireTemplateId: string; archived: true }
> = {
  name: 'legal.questionnaire_template.archive',
  description:
    'Archive a reusable questionnaire template (status archived — kept as history, dropped from active listings). Append-only via the core entity.archive.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { questionnaireTemplateId: { type: 'string' } },
    required: ['questionnaireTemplateId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    archiveQuestionnaireTemplate(ctx, input.questionnaireTemplateId),
}

registerTool(listTool)
registerTool(getTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(archiveTool)
