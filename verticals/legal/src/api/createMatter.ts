import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'

export interface CreateMatterInput {
  matterNumber: string
  clientFullName: string
  clientEmail: string
  practiceArea: string
  summary: string
}

export async function createMatter(
  ctx: ActionContext,
  input: CreateMatterInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.matter.create',
    intentKind: 'enforcement',
    payload: {
      matter_number: input.matterNumber,
      client_full_name: input.clientFullName,
      client_email: input.clientEmail,
      practice_area: input.practiceArea,
      summary: input.summary,
    },
  })
}
