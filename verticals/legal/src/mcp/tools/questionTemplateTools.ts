import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listQuestionTemplates,
  getQuestionTemplate,
  createQuestionTemplate,
  updateQuestionTemplate,
  archiveQuestionTemplate,
  type QuestionTemplate,
  type CreateQuestionTemplateInput,
  type UpdateQuestionTemplateInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Question library (migration 0077) — the firm's reusable, single questions, each
// with a stable {{answer}} token, addable to any questionnaire. Mirrors the
// questionnaire-library tools. Attorney-only (not in CLIENT_PORTAL_TOOLS;
// clientPolicy.ts is default-deny).

const OPTIONS_PROP = {
  type: 'array' as const,
  items: { type: 'string' as const },
  description: 'Choices for a select / checkbox question.',
}

const listTool: Tool<Record<string, never>, { questions: QuestionTemplate[] }> = {
  name: 'legal.question_template.list',
  description:
    "List the firm's reusable library questions — each a single intake question with its label, answer type, options, and stable {{answer}} token. Used by the 'Add from library' picker.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ questions: await listQuestionTemplates(ctx) }),
}

const getTool: Tool<{ questionTemplateId: string }, { question: QuestionTemplate | null }> = {
  name: 'legal.question_template.get',
  description: 'Fetch one library question (label, type, options, token).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { questionTemplateId: { type: 'string' } },
    required: ['questionTemplateId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    question: await getQuestionTemplate(ctx, input.questionTemplateId),
  }),
}

const createTool: Tool<CreateQuestionTemplateInput, { question: QuestionTemplate }> = {
  name: 'legal.question_template.create',
  description:
    'Create a reusable library question: a label, an answer type, optional choices, and an optional {{answer}} token (derived from the label and kept unique if omitted). Addable to any questionnaire.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      type: { type: 'string', description: 'A KnownFieldType answer widget.' },
      token: {
        type: 'string',
        description: 'Optional {{answer}} key; derived from label if omitted.',
      },
      options: OPTIONS_PROP,
    },
    required: ['label', 'type'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    question: await createQuestionTemplate(ctx, input),
  }),
}

const updateTool: Tool<UpdateQuestionTemplateInput, { question: QuestionTemplate }> = {
  name: 'legal.question_template.update',
  description:
    'Update a library question (label / type / token / options). Append-only: a new attribute version supersedes the prior.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      questionTemplateId: { type: 'string' },
      label: { type: 'string' },
      type: { type: 'string' },
      token: { type: 'string' },
      options: OPTIONS_PROP,
    },
    required: ['questionTemplateId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    question: await updateQuestionTemplate(ctx, input),
  }),
}

const archiveTool: Tool<
  { questionTemplateId: string },
  { questionTemplateId: string; archived: true }
> = {
  name: 'legal.question_template.archive',
  description:
    'Archive a library question (status archived — kept as history, dropped from active listings). Append-only via the core entity.archive.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { questionTemplateId: { type: 'string' } },
    required: ['questionTemplateId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    archiveQuestionTemplate(ctx, input.questionTemplateId),
}

registerTool(listTool)
registerTool(getTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(archiveTool)
