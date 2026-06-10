import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface RecordEventInput {
  eventKindName: string
  primaryEntityId?: string
  secondaryEntityIds?: string[]
  data?: Record<string, unknown>
  confidence?: number
  sourceType?: string
  occurredAt?: string
  occurredAtPrecision?: string
  intentKind?: IntentKind
}

export async function recordEvent(
  ctx: ActionContext,
  input: RecordEventInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: input.intentKind ?? 'unknown',
    payload: {
      event_kind_name: input.eventKindName,
      primary_entity_id: input.primaryEntityId,
      secondary_entity_ids: input.secondaryEntityIds,
      data: input.data ?? {},
      confidence: input.confidence,
      source_type: input.sourceType,
      occurred_at: input.occurredAt,
      occurred_at_precision: input.occurredAtPrecision,
    },
  })
}
