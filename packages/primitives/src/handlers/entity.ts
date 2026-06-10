import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'

interface EntityCreatePayload {
  entity_kind_name: string
  name?: string
  attributes?: Array<{
    attributeKindName: string
    value: unknown
    confidence: number
    knowabilityState: string
    timePrecision: string
    sourceType?: string
    sourceRef?: string
  }>
}

async function lookupEntityKindId(
  client: DbClient,
  tenantId: string,
  kindName: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM entity_kind_definition
     WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active'
     ORDER BY valid_from DESC LIMIT 1`,
    [tenantId, kindName],
  )
  if (result.rowCount === 0 || !result.rows[0]) {
    throw new Error(`Entity kind not found: ${kindName}`)
  }
  return result.rows[0].id
}

async function lookupAttributeKindId(
  client: DbClient,
  tenantId: string,
  kindName: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM attribute_kind_definition
     WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active'
     ORDER BY valid_from DESC LIMIT 1`,
    [tenantId, kindName],
  )
  if (result.rowCount === 0 || !result.rows[0]) {
    throw new Error(`Attribute kind not found: ${kindName}`)
  }
  return result.rows[0].id
}

export async function insertEntity(
  client: DbClient,
  tenantId: string,
  actionId: string,
  entityKindId: string,
  name: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const entityId = randomUUID()
  await client.query(
    `INSERT INTO entity (
       id, tenant_id, action_id, entity_kind_id, name, status, metadata
     ) VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
    [entityId, tenantId, actionId, entityKindId, name, metadata],
  )
  return entityId
}

export async function insertAttribute(
  client: DbClient,
  tenantId: string,
  actionId: string,
  entityId: string,
  attributeKindId: string,
  value: unknown,
  confidence: number,
  knowabilityState: string,
  timePrecision: string,
  sourceType: string,
  sourceRef: string | null,
): Promise<string> {
  const attributeId = randomUUID()
  await client.query(
    `INSERT INTO attribute (
       id, tenant_id, action_id, entity_id, attribute_kind_id, value,
       confidence, knowability_state, time_precision, source_type, source_ref
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      attributeId,
      tenantId,
      actionId,
      entityId,
      attributeKindId,
      JSON.stringify(value),
      confidence,
      knowabilityState,
      timePrecision,
      sourceType,
      sourceRef,
    ],
  )
  return attributeId
}

registerActionHandler('entity.create', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as EntityCreatePayload
  const entityKindId = await lookupEntityKindId(client, ctx.tenantId, parsed.entity_kind_name)
  const entityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    entityKindId,
    // Default the display name to the kind when the caller does not supply one
    // (entity.name is NOT NULL; createEntity does not require a name).
    parsed.name ?? parsed.entity_kind_name,
  )

  const attributeIds: string[] = []
  if (parsed.attributes?.length) {
    for (const attribute of parsed.attributes) {
      const attributeKindId = await lookupAttributeKindId(
        client,
        ctx.tenantId,
        attribute.attributeKindName,
      )
      const attributeId = await insertAttribute(
        client,
        ctx.tenantId,
        actionId,
        entityId,
        attributeKindId,
        attribute.value,
        attribute.confidence,
        attribute.knowabilityState,
        attribute.timePrecision,
        attribute.sourceType ?? 'human',
        attribute.sourceRef ?? ctx.actorId,
      )
      attributeIds.push(attributeId)
    }
  }

  return { entityId, attributeIds }
})
