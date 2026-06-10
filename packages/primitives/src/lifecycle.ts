import type { ActionContext, ActionResult } from '@exsto/substrate'
import { submitAction } from '@exsto/substrate'
import type { IntentKind } from '@exsto/shared'

export interface UpdateEntityInput {
  entityId: string
  name?: string
  status?: 'active' | 'archived' | 'suspended'
  metadata?: Record<string, unknown>
  intentKind: IntentKind
}

export async function updateEntity(
  ctx: ActionContext,
  input: UpdateEntityInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'entity.update',
    intentKind: input.intentKind,
    targetKind: 'entity',
    targetId: input.entityId,
    payload: {
      entity_id: input.entityId,
      name: input.name,
      status: input.status,
      metadata: input.metadata,
    },
  })
}

export async function archiveEntity(
  ctx: ActionContext,
  entityId: string,
  intentKind: IntentKind = 'adjustment',
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'entity.archive',
    intentKind,
    targetKind: 'entity',
    targetId: entityId,
    payload: { entity_id: entityId },
  })
}

export async function closeRelationship(
  ctx: ActionContext,
  relationshipId: string,
  intentKind: IntentKind = 'adjustment',
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'relationship.close',
    intentKind,
    targetKind: 'relationship',
    targetId: relationshipId,
    payload: { relationship_id: relationshipId },
  })
}
