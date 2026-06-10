// Schema-as-data: define new kinds at runtime by inserting definition rows
// (invariants 12, 23). Routed through the action layer like any other write, and
// audited via schema_migration (append-only) + configuration_change. This is
// what makes "add a custom field / new entity kind without a migration" real.
import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'

type Registry =
  | 'entity'
  | 'attribute'
  | 'relationship'
  | 'event'
  | 'judgment'
  | 'outcome'
  | 'period'

const REGISTRY_TABLE: Record<Registry, string> = {
  entity: 'entity_kind_definition',
  attribute: 'attribute_kind_definition',
  relationship: 'relationship_kind_definition',
  event: 'event_kind_definition',
  judgment: 'judgment_kind_definition',
  outcome: 'outcome_kind_definition',
  period: 'period_kind_definition',
}

// Per-registry whitelist of optional scalar columns (prevents identifier
// injection while still allowing the richer config columns from migration 0012).
const EXTRA_COLUMNS: Record<Registry, string[]> = {
  entity: [
    'parent_kind_id',
    'supports_temporal_state',
    'supports_judgment',
    'supports_outcomes',
    'requires_period',
  ],
  attribute: [
    'on_entity_kind_id',
    'value_type',
    'is_required',
    'is_indexed',
    'is_pii',
    'is_computed',
  ],
  relationship: [
    'source_entity_kind_id',
    'target_entity_kind_id',
    'cardinality',
    'directionality',
    'inverse_kind_name',
  ],
  event: ['is_state_change', 'immutability_tier'],
  judgment: ['about_entity_kind_id', 'value_type', 'decay_function', 'half_life_days'],
  outcome: ['about_entity_kind_id', 'polarity', 'is_terminal'],
  period: ['fiscal_year_start_month'],
}

interface KindDefinePayload {
  registry: Registry
  kind_name: string
  display_name: string
  description?: string
  extra?: Record<string, unknown>
}

registerActionHandler('kind.define', async (ctx, client: DbClient, payload, actionId) => {
  const p = payload as unknown as KindDefinePayload
  const table = REGISTRY_TABLE[p.registry]
  if (!table) throw new Error(`Unknown registry: ${p.registry}`)

  const cols = ['tenant_id', 'kind_name', 'display_name', 'description']
  const vals: unknown[] = [ctx.tenantId, p.kind_name, p.display_name, p.description ?? null]

  for (const col of EXTRA_COLUMNS[p.registry]) {
    if (p.extra && Object.prototype.hasOwnProperty.call(p.extra, col)) {
      cols.push(col)
      vals.push(p.extra[col])
    }
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ')
  const definitionId = randomUUID()
  cols.push('id')
  vals.push(definitionId)

  await client.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}, $${vals.length})`,
    vals,
  )

  // Audit: append-only schema_migration + configuration_change.
  await client.query(
    `INSERT INTO schema_migration (tenant_id, action_id, change_kind, target_kind, target_kind_name, definition_id, details)
     VALUES ($1, $2, 'added', $3, $4, $5, $6::jsonb)`,
    [
      ctx.tenantId,
      actionId,
      `${p.registry}_kind`,
      p.kind_name,
      definitionId,
      JSON.stringify({ display_name: p.display_name }),
    ],
  )
  await client.query(
    `INSERT INTO configuration_change (tenant_id, action_id, target_table, target_id, change_kind, after_value, authoring_actor_id)
     VALUES ($1, $2, $3, $4, 'create', $5::jsonb, $6)`,
    [
      ctx.tenantId,
      actionId,
      table,
      definitionId,
      JSON.stringify({ kind_name: p.kind_name, ...(p.extra ?? {}) }),
      ctx.actorId,
    ],
  )

  return { definitionId, registry: p.registry, kindName: p.kind_name }
})
