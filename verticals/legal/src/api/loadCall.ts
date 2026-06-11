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
// the demo seed to load a realistic pre-written transcript through the same
// raw_event.ingest → call.ingest pipeline shape as production.
export async function loadCall(ctx: ActionContext, input: LoadCallInput): Promise<ActionResult> {
  const raw = await submitAction(ctx, {
    actionKindName: 'raw_event.ingest',
    intentKind: 'exploration',
    payload: {
      source_type: 'integration',
      source_ref: 'granola:demo-seed',
      external_id: input.externalCallId,
      payload: input.rawPayload ?? {
        call_id: input.externalCallId,
        source: 'demo-seed',
        started_at: input.startedAt,
        ended_at: input.endedAt,
      },
    },
  })
  const rawEffects = (raw.effects[0] ?? {}) as { rawEventLogId?: string }

  return submitAction(ctx, {
    actionKindName: 'call.ingest',
    intentKind: 'exploration',
    payload: {
      granola_call_id: input.externalCallId,
      matter_entity_id: input.matterEntityId,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      duration_seconds: Math.round(
        (new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime()) / 1000,
      ),
      transcript_text: input.transcriptText,
      transcript_source: input.transcriptSource ?? 'manual',
      notes: null,
      attendee_emails: [],
      raw_event_log_id: rawEffects.rawEventLogId ?? null,
    },
  })
}
