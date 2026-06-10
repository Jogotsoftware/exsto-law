import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface AssertIdentityInput {
  assertionKind: 'same_as' | 'different_from' | 'related_to'
  entityAId: string
  entityBId: string
  confidence: number
  evidence?: unknown[]
  supersedesId?: string
  intentKind?: IntentKind
}

// Non-destructive identity assertion (invariant 4): merges/links are facts, not
// deletes. A correction is a new assertion that supersedes the prior one.
export async function assertIdentity(
  ctx: ActionContext,
  input: AssertIdentityInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'identity.assert',
    intentKind: input.intentKind ?? 'reflection',
    payload: {
      assertion_kind: input.assertionKind,
      entity_a_id: input.entityAId,
      entity_b_id: input.entityBId,
      confidence: input.confidence,
      evidence: input.evidence ?? [],
      supersedes_id: input.supersedesId,
    },
  })
}
