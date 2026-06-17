import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import {
  getStandaloneTemplate,
  type StandaloneTemplate,
  type StandaloneTemplateCategory,
} from '../queries/templates.js'

// Write API for standalone templates (beta sprint Obj 9). Create/update go through
// the legal.template.* actions; archive reuses the core entity.archive. Each
// returns the resolved template so the UI can render immediately.

export interface CreateTemplateInput {
  name: string
  category: StandaloneTemplateCategory
  body: string
  docKind?: string | null
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
    },
  })
  const updated = await getStandaloneTemplate(ctx, input.templateEntityId)
  if (!updated) throw new Error('Template updated but could not be read back.')
  return updated
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
