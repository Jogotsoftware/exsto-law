import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface CreateRelationshipInput {
  sourceEntityId: string
  targetEntityId: string
  relationshipKindName: string
  properties?: Record<string, unknown>
  intentKind: IntentKind
}

export async function createRelationship(
  ctx: ActionContext,
  input: CreateRelationshipInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'relationship.create',
    intentKind: input.intentKind,
    payload: {
      source_entity_id: input.sourceEntityId,
      target_entity_id: input.targetEntityId,
      relationship_kind_name: input.relationshipKindName,
      properties: input.properties ?? {},
    },
  })
}
