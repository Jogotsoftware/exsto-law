import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'

export interface LoadCallInput {
  matterEntityId: string
  externalCallId: string
  startedAt: string
  endedAt: string
  transcriptText: string
  transcriptSource?: 'stub' | 'granola' | 'manual'
  rawPayload?: Record<string, unknown>
}

// Records a call session + transcript with caller-supplied content. Used by
// the demo seed to load a realistic pre-written transcript. Same handler as
// legal.call.simulate, just with payload values the caller controls instead
// of the synthetic ones the Granola stub adapter produces.
export async function loadCall(ctx: ActionContext, input: LoadCallInput): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.call.simulate',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: input.matterEntityId,
      external_call_id: input.externalCallId,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      transcript_text: input.transcriptText,
      transcript_source: input.transcriptSource ?? 'manual',
      raw_payload: input.rawPayload ?? {
        external_call_id: input.externalCallId,
        source: 'demo-seed',
        started_at: input.startedAt,
        ended_at: input.endedAt,
      },
    },
  })
}
