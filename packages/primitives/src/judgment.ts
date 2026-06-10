import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface RecordJudgmentInput {
  subjectEntityId: string
  judgmentKindName: string
  value: unknown
  confidence: number
  evidence?: unknown[]
  reasoning?: string
  reasoningTraceId?: string
  polarity?: 'positive' | 'negative'
  intentKind?: IntentKind
}

export async function recordJudgment(
  ctx: ActionContext,
  input: RecordJudgmentInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'judgment.record',
    intentKind: input.intentKind ?? 'reflection',
    reasoningTraceId: input.reasoningTraceId,
    payload: {
      subject_entity_id: input.subjectEntityId,
      judgment_kind_name: input.judgmentKindName,
      value: input.value,
      confidence: input.confidence,
      evidence: input.evidence ?? [],
      reasoning: input.reasoning ?? null,
      reasoning_trace_id: input.reasoningTraceId ?? null,
      polarity: input.polarity ?? 'positive',
    },
  })
}
