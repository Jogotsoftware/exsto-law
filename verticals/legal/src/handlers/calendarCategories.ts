// legal.calendar.categories.update — write the firm's category palette to the
// singleton firm.calendar_categories workflow_definition (seal-and-insert +
// configuration_change audit, exactly like legal.booking_rules.update). And
// legal.booking.categorize — set a matter's consultation_category attribute. Both
// write only through the action layer (hard rule 1).
import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, lookupKindId } from './common.js'
import { normalizeCalendarCategories } from '../api/calendarCategories.js'

const KIND = 'firm.calendar_categories'

interface CurrentRow {
  id: string
  version: number
  transitions: unknown
}

async function currentActive(client: DbClient, tenantId: string): Promise<CurrentRow | null> {
  const res = await client.query<CurrentRow>(
    `SELECT id, version, transitions FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC LIMIT 1`,
    [tenantId, KIND],
  )
  return res.rows[0] ?? null
}

registerActionHandler('legal.calendar.categories.update', async (ctx, client, payload, actionId) => {
  // Re-normalize in the handler too (a direct MCP call bypasses the api helper).
  const categories = normalizeCalendarCategories(
    (payload as { categories?: unknown }).categories ?? payload,
  )

  const prior = await currentActive(client, ctx.tenantId)
  const nextVersion = prior ? prior.version + 1 : 1

  if (prior) {
    await client.query(
      `UPDATE workflow_definition SET valid_to = now(), status = 'deprecated'
        WHERE tenant_id = $1 AND id = $2`,
      [ctx.tenantId, prior.id],
    )
  }

  const newId = randomUUID()
  await client.query(
    `INSERT INTO workflow_definition
       (id, tenant_id, action_id, kind_name, display_name, description,
        states, transitions, participating_entity_kinds, version, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,'active')`,
    [
      newId,
      ctx.tenantId,
      actionId,
      KIND,
      'Firm calendar categories',
      'Singleton firm-level calendar category palette ({key,label,color}[]) for color-coding call types.',
      JSON.stringify([]),
      JSON.stringify({ categories }),
      JSON.stringify([]),
      nextVersion,
    ],
  )

  await client.query(
    `INSERT INTO configuration_change
       (tenant_id, action_id, target_table, target_id, change_kind,
        before_value, after_value, authoring_actor_id)
     VALUES ($1, $2, 'workflow_definition', $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      ctx.tenantId,
      actionId,
      newId,
      prior ? 'update' : 'create',
      prior ? JSON.stringify({ version: prior.version, transitions: prior.transitions }) : null,
      JSON.stringify({ kind_name: KIND, version: nextVersion, categories }),
      ctx.actorId,
    ],
  )

  return { workflowDefinitionId: newId, version: nextVersion, categories }
})

registerActionHandler('legal.booking.categorize', async (ctx, client, payload, actionId) => {
  const p = payload as { matter_entity_id: string; category_key: string }
  if (!p.matter_entity_id) throw new Error('matter_entity_id is required')
  const categoryKey = (p.category_key ?? '').trim()

  const attrKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'consultation_category',
  )
  // Bitemporal supersession: close the prior open category (valid_to is the only
  // mutable column on an open fact row — append-only invariant), then append the
  // new one. An empty key just clears it.
  await client.query(
    `UPDATE attribute SET valid_to = now()
      WHERE tenant_id = $1 AND entity_id = $2 AND attribute_kind_id = $3 AND valid_to IS NULL`,
    [ctx.tenantId, p.matter_entity_id, attrKindId],
  )
  if (categoryKey) {
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: p.matter_entity_id,
      attributeKindId: attrKindId,
      value: categoryKey,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }
  return { matterEntityId: p.matter_entity_id, categoryKey }
})
