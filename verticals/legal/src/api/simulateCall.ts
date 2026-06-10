import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import { buildStubCallSession } from '../adapters/granola.js'
import { getMatter } from '../queries/matters.js'

export interface SimulateCallInput {
  matterEntityId: string
}

export async function simulateCall(
  ctx: ActionContext,
  input: SimulateCallInput,
): Promise<ActionResult> {
  const matter = await getMatter(ctx, input.matterEntityId)
  if (!matter) {
    throw new Error(`Matter not found: ${input.matterEntityId}`)
  }

  const questionnaireResponses = (matter.questionnaireResponses ?? {}) as Record<string, unknown>
  const stub = buildStubCallSession({
    matterClientName: (matter.attributes.client_name as string | undefined) ?? 'the client',
    matterCompanyName:
      (questionnaireResponses['company_name'] as string | undefined) ??
      `Matter ${matter.matterNumber}`,
    matterSummary: (matter.attributes.matter_summary as string | undefined) ?? '',
    questionnaireHighlights: pickQuestionnaireHighlights(questionnaireResponses),
  })

  return submitAction(ctx, {
    actionKindName: 'legal.call.simulate',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: input.matterEntityId,
      external_call_id: stub.external_call_id,
      started_at: stub.started_at,
      ended_at: stub.ended_at,
      transcript_text: stub.transcript_text,
      transcript_source: stub.transcript_source,
      raw_payload: stub,
    },
  })
}

function pickQuestionnaireHighlights(responses: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'company_name',
    'company_purpose',
    'management_structure',
    'fee_structure',
    'fee_amount',
  ]
  const highlights: Record<string, unknown> = {}
  for (const key of keys) {
    if (responses[key] !== undefined) {
      highlights[key] = responses[key]
    }
  }
  return highlights
}
