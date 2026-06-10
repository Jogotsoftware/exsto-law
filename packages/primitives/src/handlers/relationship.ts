import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'

interface RelationshipCreatePayload {
  source_entity_id: string
  target_entity_id: string
  relationship_kind_name: string
  properties?: Record<string, unknown>
}

async function lookupRelationshipKindId(
  client: DbClient,
  tenantId: string,
  kindName: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM relationship_kind_definition
     WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active'
     ORDER BY valid_from DESC LIMIT 1`,
    [tenantId, kindName],
  )
  if (result.rowCount === 0 || !result.rows[0]) {
    throw new Error(`Relationship kind not found: ${kindName}`)
  }
  return result.rows[0].id
}

export async function insertRelationship(
  client: DbClient,
  tenantId: string,
  actionId: string,
  sourceEntityId: string,
  targetEntityId: string,
  relationshipKindId: string,
  properties: Record<string, unknown> = {},
): Promise<string> {
  const relationshipId = randomUUID()
  await client.query(
    `INSERT INTO relationship (
       id, tenant_id, action_id, source_entity_id, target_entity_id,
       relationship_kind_id, properties
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      relationshipId,
      tenantId,
      actionId,
      sourceEntityId,
      targetEntityId,
      relationshipKindId,
      properties,
    ],
  )
  return relationshipId
}

registerActionHandler('relationship.create', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as RelationshipCreatePayload
  const relationshipKindId = await lookupRelationshipKindId(
    client,
    ctx.tenantId,
    parsed.relationship_kind_name,
  )
  const relationshipId = await insertRelationship(
    client,
    ctx.tenantId,
    actionId,
    parsed.source_entity_id,
    parsed.target_entity_id,
    relationshipKindId,
    parsed.properties ?? {},
  )
  return { relationshipId }
})
