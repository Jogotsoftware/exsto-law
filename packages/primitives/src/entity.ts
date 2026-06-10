import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface EntityAttributeInput {
  attributeKindName: string
  value: unknown
  confidence: number
  knowabilityState: string
  timePrecision: string
}

export interface CreateEntityInput {
  entityKindName: string
  attributes: EntityAttributeInput[]
  intentKind: IntentKind
}

export async function createEntity(
  ctx: ActionContext,
  input: CreateEntityInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'entity.create',
    intentKind: input.intentKind,
    payload: {
      entity_kind_name: input.entityKindName,
      attributes: input.attributes,
    },
  })
}
