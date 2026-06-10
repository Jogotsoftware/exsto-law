import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface SubmitPrimitiveActionInput {
  actionKindName: string
  payload: Record<string, unknown>
  intentKind: IntentKind
}

export async function submitPrimitiveAction(
  ctx: ActionContext,
  input: SubmitPrimitiveActionInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: input.actionKindName,
    intentKind: input.intentKind,
    payload: input.payload,
  })
}
