import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  cloneTemplate,
  createTemplate,
  deleteTemplate,
  getTemplate,
  importPdfTemplate,
  listTemplates,
  updateTemplate,
  type CloneTemplateInput,
  type CreateTemplateInput,
  type DocumentTemplate,
  type ImportPdfInput,
  type ImportPdfResult,
  type UpdateTemplateInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const listTool: Tool<Record<string, never>, { templates: DocumentTemplate[] }> = {
  name: 'legal.template.list',
  description: 'List all document templates the attorney can edit.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ templates: await listTemplates(ctx) }),
}

const getTool: Tool<{ templateKey: string }, { template: DocumentTemplate | null }> = {
  name: 'legal.template.get',
  description: 'Get a single document template by key.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    template: await getTemplate(ctx, input.templateKey),
  }),
}

const updateTool: Tool<UpdateTemplateInput, { template: DocumentTemplate }> = {
  name: 'legal.template.update',
  description:
    'Update a document template (name, description, body, variable schema, active state).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({ template: await updateTemplate(ctx, input) }),
}

const createTool: Tool<CreateTemplateInput, { template: DocumentTemplate }> = {
  name: 'legal.template.create',
  description: 'Create a new document template.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({ template: await createTemplate(ctx, input) }),
}

const cloneTool: Tool<CloneTemplateInput, { template: DocumentTemplate }> = {
  name: 'legal.template.clone',
  description: 'Clone an existing document template (auto-generates a new key + display name).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({ template: await cloneTemplate(ctx, input) }),
}

const deleteTool: Tool<{ templateKey: string }, { deleted: boolean }> = {
  name: 'legal.template.delete',
  description: 'Permanently delete a document template by key.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => deleteTemplate(ctx, input.templateKey),
}

const importPdfTool: Tool<ImportPdfInput, ImportPdfResult> = {
  name: 'legal.template.import_pdf',
  description:
    'Extract text from a base64-encoded PDF and return template-ready markdown + html plus any detected variables.',
  mode: 'read',
  handler: async (_ctx: ActionContext, input) => importPdfTemplate(input),
}

registerTool(listTool)
registerTool(getTool)
registerTool(updateTool)
registerTool(createTool)
registerTool(cloneTool)
registerTool(deleteTool)
registerTool(importPdfTool)
