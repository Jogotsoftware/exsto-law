import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import { buildStubCallSession } from '../adapters/granola.js'
import { getMatter } from '../queries/matters.js'

export interface SimulateCallInput {
  matterEntityId: string
}

// Local-dev / demo driver: produces a stub Granola payload and runs it through
// the SAME pipeline shape as production (raw_event.ingest → call.ingest), so
// stub assumptions cannot leak into callers (binding Lesson #1). The matter is
// explicit, so matching is skipped.
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

  const raw = await submitAction(ctx, {
    actionKindName: 'raw_event.ingest',
    intentKind: 'exploration',
    payload: {
      source_type: 'integration',
      source_ref: 'granola:stub',
      external_id: stub.call_id,
      payload: stub,
    },
  })
  const rawEffects = (raw.effects[0] ?? {}) as { rawEventLogId?: string }

  return submitAction(ctx, {
    actionKindName: 'call.ingest',
    intentKind: 'exploration',
    payload: {
      granola_call_id: stub.call_id,
      matter_entity_id: input.matterEntityId,
      started_at: stub.started_at,
      ended_at: stub.ended_at,
      duration_seconds: Math.round(
        (new Date(stub.ended_at).getTime() - new Date(stub.started_at).getTime()) / 1000,
      ),
      transcript_text: stub.transcript,
      transcript_source: 'stub',
      notes: null,
      attendee_emails: stub.attendees.map((a) => a.email),
      raw_event_log_id: rawEffects.rawEventLogId ?? null,
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
