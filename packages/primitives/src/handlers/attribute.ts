import { registerActionHandler } from '@exsto/substrate'
import { insertAttribute } from './entity.js'
import type { DbClient } from '@exsto/shared'

interface AttributeCreatePayload {
  entity_id: string
  attribute_kind_name: string
  value: unknown
  confidence: number
  knowability_state: string
  time_precision: string
  source_type?: string
  source_ref?: string
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

registerActionHandler('attribute.create', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as AttributeCreatePayload
  const attributeKindId = await lookupAttributeKindId(
    client,
    ctx.tenantId,
    parsed.attribute_kind_name,
  )
  const attributeId = await insertAttribute(
    client,
    ctx.tenantId,
    actionId,
    parsed.entity_id,
    attributeKindId,
    parsed.value,
    parsed.confidence,
    parsed.knowability_state,
    parsed.time_precision,
    parsed.source_type ?? 'human',
    parsed.source_ref ?? ctx.actorId,
  )
  return { attributeId }
})
