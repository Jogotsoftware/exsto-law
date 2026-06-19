import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import {
  getQuestionnaireTemplate,
  type QuestionnaireSchema,
  type QuestionnaireTemplate,
} from '../queries/questionnaireLibrary.js'

// Write API for the questionnaire library (migration 0067). Create/update go
// through the legal.questionnaire_template.* actions; archive reuses the core
// entity.archive. Each returns the resolved template so the UI renders immediately.
// Mirrors the standalone template write API.

export interface CreateQuestionnaireTemplateInput {
  name: string
  description?: string | null
  schema: QuestionnaireSchema
}

export async function createQuestionnaireTemplate(
  ctx: ActionContext,
  input: CreateQuestionnaireTemplateInput,
): Promise<QuestionnaireTemplate> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.questionnaire_template.create',
    intentKind: 'enforcement',
    payload: {
      name: input.name,
      description: input.description ?? null,
      schema: input.schema,
    },
  })
  const { questionnaireTemplateId } = res.effects[0] as { questionnaireTemplateId: string }
  const created = await getQuestionnaireTemplate(ctx, questionnaireTemplateId)
  if (!created) throw new Error('Questionnaire created but could not be read back.')
  return created
}

export interface UpdateQuestionnaireTemplateInput {
  questionnaireTemplateId: string
  name?: string
  description?: string | null
  schema?: QuestionnaireSchema
}

export async function updateQuestionnaireTemplate(
  ctx: ActionContext,
  input: UpdateQuestionnaireTemplateInput,
): Promise<QuestionnaireTemplate> {
  await submitAction(ctx, {
    actionKindName: 'legal.questionnaire_template.update',
    intentKind: 'adjustment',
    payload: {
      questionnaire_template_id: input.questionnaireTemplateId,
      name: input.name,
      description: input.description,
      schema: input.schema,
    },
  })
  const updated = await getQuestionnaireTemplate(ctx, input.questionnaireTemplateId)
  if (!updated) throw new Error('Questionnaire updated but could not be read back.')
  return updated
}

// Archive through the core entity.archive action (status 'archived' — kept as
// history, dropped from active listings). Append-only.
export async function archiveQuestionnaireTemplate(
  ctx: ActionContext,
  questionnaireTemplateId: string,
): Promise<{ questionnaireTemplateId: string; archived: true }> {
  await archiveEntity(ctx, questionnaireTemplateId)
  return { questionnaireTemplateId, archived: true }
}
