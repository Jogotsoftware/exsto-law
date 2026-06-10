import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'

export interface SubmitQuestionnaireInput {
  matterEntityId: string
  templateId: string
  responses: Record<string, unknown>
}

export async function submitQuestionnaire(
  ctx: ActionContext,
  input: SubmitQuestionnaireInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.questionnaire.submit',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: input.matterEntityId,
      template_id: input.templateId,
      responses: input.responses,
    },
  })
}
