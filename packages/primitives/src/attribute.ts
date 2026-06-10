import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface CreateAttributeInput {
  entityId: string
  attributeKindName: string
  value: unknown
  confidence: number
  knowabilityState: string
  timePrecision: string
  sourceType?: string
  intentKind: IntentKind
}

// Raw append of an attribute observation (does not close prior values).
export async function createAttribute(
  ctx: ActionContext,
  input: CreateAttributeInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'attribute.create',
    intentKind: input.intentKind,
    payload: {
      entity_id: input.entityId,
      attribute_kind_name: input.attributeKindName,
      value: input.value,
      confidence: input.confidence,
      knowability_state: input.knowabilityState,
      time_precision: input.timePrecision,
      source_type: input.sourceType,
    },
  })
}

// Canonical "the value is now X": closes the prior open observation of the same
// kind on this entity (temporal supersession, invariant 2).
export async function setAttribute(
  ctx: ActionContext,
  input: CreateAttributeInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'attribute.set',
    intentKind: input.intentKind,
    payload: {
      entity_id: input.entityId,
      attribute_kind_name: input.attributeKindName,
      value: input.value,
      confidence: input.confidence,
      knowability_state: input.knowabilityState,
      time_precision: input.timePrecision,
      source_type: input.sourceType,
    },
  })
}
