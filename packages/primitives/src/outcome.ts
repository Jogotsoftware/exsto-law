import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface RecordOutcomeInput {
  subjectEntityId: string
  outcomeKindName: string
  outcomeData?: Record<string, unknown>
  polarity?: 'positive' | 'negative' | 'neutral'
  confidence?: number
  evidence?: unknown[]
  occurredAt?: string
  occurredAtPrecision?: string
  intentKind?: IntentKind
}

export async function recordOutcome(
  ctx: ActionContext,
  input: RecordOutcomeInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'outcome.record',
    intentKind: input.intentKind ?? 'unknown',
    payload: {
      subject_entity_id: input.subjectEntityId,
      outcome_kind_name: input.outcomeKindName,
      outcome_data: input.outcomeData ?? {},
      polarity: input.polarity ?? 'neutral',
      confidence: input.confidence,
      evidence: input.evidence ?? [],
      occurred_at: input.occurredAt,
      occurred_at_precision: input.occurredAtPrecision,
    },
  })
}
