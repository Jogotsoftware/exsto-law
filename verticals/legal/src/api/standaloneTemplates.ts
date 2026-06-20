import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import { chatWithAssistant } from '../adapters/claude.js'
import {
  getStandaloneTemplate,
  type StandaloneTemplate,
  type StandaloneTemplateCategory,
  type TemplateVariables,
} from '../queries/templates.js'

// Write API for standalone templates (beta sprint Obj 9). Create/update go through
// the legal.template.* actions; archive reuses the core entity.archive. Each
// returns the resolved template so the UI can render immediately.

export interface CreateTemplateInput {
  name: string
  category: StandaloneTemplateCategory
  body: string
  docKind?: string | null
  variables?: TemplateVariables
}

export async function createTemplate(
  ctx: ActionContext,
  input: CreateTemplateInput,
): Promise<StandaloneTemplate> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.template.create',
    intentKind: 'enforcement',
    payload: {
      name: input.name,
      category: input.category,
      body: input.body,
      doc_kind: input.docKind ?? null,
      variables: input.variables,
    },
  })
  const { templateEntityId } = res.effects[0] as { templateEntityId: string }
  const created = await getStandaloneTemplate(ctx, templateEntityId)
  if (!created) throw new Error('Template created but could not be read back.')
  return created
}

export interface UpdateTemplateInput {
  templateEntityId: string
  name?: string
  body?: string
  docKind?: string | null
  variables?: TemplateVariables
}

export async function updateTemplate(
  ctx: ActionContext,
  input: UpdateTemplateInput,
): Promise<StandaloneTemplate> {
  await submitAction(ctx, {
    actionKindName: 'legal.template.update',
    intentKind: 'adjustment',
    payload: {
      template_entity_id: input.templateEntityId,
      name: input.name,
      body: input.body,
      doc_kind: input.docKind,
      variables: input.variables,
    },
  })
  const updated = await getStandaloneTemplate(ctx, input.templateEntityId)
  if (!updated) throw new Error('Template updated but could not be read back.')
  return updated
}

// AI-draft a template body from a plain-language description, using the firm's
// Settings-managed Anthropic key (claude.ts owns all Anthropic traffic). Pure
// generation — it returns text the attorney reviews and saves; it writes nothing
// to the substrate, so there is no action/reasoning trace here (the SAVE is the
// recorded write). The model is instructed to emit {{merge_tokens}} for fill-ins.
export interface AiDraftTemplateInput {
  instructions: string
  category: StandaloneTemplateCategory
}

export async function aiDraftTemplate(
  ctx: ActionContext,
  input: AiDraftTemplateInput,
): Promise<{ body: string }> {
  const instructions = input.instructions?.trim()
  if (!instructions) throw new Error('Describe the template you want drafted.')
  const kind = input.category === 'email' ? 'email' : 'legal document'
  const system = [
    `You draft reusable ${kind} TEMPLATES for a US law firm.`,
    'Output the template body ONLY — no preamble, no explanation, no markdown code fences.',
    'Wherever a value is filled in per client or matter, insert a merge token in double',
    'curly braces with a snake_case name, e.g. {{client_name}}, {{firm_name}},',
    '{{matter_number}}, {{effective_date}}. Reuse the same token name when a value recurs.',
    'Use clear headings and short paragraphs; keep it practical and ready to edit.',
  ].join(' ')
  const body = await chatWithAssistant(ctx.tenantId, [
    { role: 'system', content: system },
    { role: 'user', content: instructions },
  ])
  return { body: body.trim() }
}

// Archive a standalone template through the core entity.archive action (status
// 'archived' — kept as history, dropped from active listings). Append-only.
export async function archiveTemplate(
  ctx: ActionContext,
  templateEntityId: string,
): Promise<{ templateEntityId: string; archived: true }> {
  await archiveEntity(ctx, templateEntityId)
  return { templateEntityId, archived: true }
}
