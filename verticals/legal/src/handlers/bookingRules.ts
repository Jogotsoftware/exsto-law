// ───────────────────────────────────────────────────────────────────────────
// legal.booking_rules.update — the Contract L write path for firm booking rules.
//
// Rules are config-as-data: a SINGLETON workflow_definition row per tenant
// (kind_name `firm.booking_rules`) carrying the rules under `transitions`. Like
// legal.service.upsert, an update is never an in-place edit — it SEALS the
// current active row (valid_to = now(), status = 'deprecated') and INSERTs
// version+1, so the history of every rules change is immutable, and appends a
// configuration_change row (the audit of who changed config).
//
// Writing workflow_definition from a handler is allowed: the handler IS the
// action layer (hard rule 1). The row is excluded from the service lists
// (api/services.ts) by its reserved kind_name, so it never appears as a
// bookable service.
// ───────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { normalizeFirmBookingRules } from '../api/firmBookingRules.js'

const KIND = 'firm.booking_rules'

interface CurrentRow {
  id: string
  version: number
  transitions: unknown
}

async function currentActive(client: DbClient, tenantId: string): Promise<CurrentRow | null> {
  const res = await client.query<CurrentRow>(
    `SELECT id, version, transitions
       FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC
      LIMIT 1`,
    [tenantId, KIND],
  )
  return res.rows[0] ?? null
}

registerActionHandler('legal.booking_rules.update', async (ctx, client, payload, actionId) => {
  // Validate + clamp here too: a direct MCP call bypasses the api helper, so the
  // handler is the last line that guarantees a well-formed, bookable ruleset.
  const rules = normalizeFirmBookingRules((payload as { rules?: unknown }).rules)

  const prior = await currentActive(client, ctx.tenantId)
  const nextVersion = prior ? prior.version + 1 : 1

  // Seal the prior active row FIRST (bitemporal close), then the new version is
  // the sole active row.
  if (prior) {
    await client.query(
      `UPDATE workflow_definition
          SET valid_to = now(), status = 'deprecated'
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
      'Firm booking rules',
      'Singleton firm-level booking constraints (Contract L): bookable days/hours, buffer, lead time, slot granularity, default duration.',
      JSON.stringify([]),
      JSON.stringify(rules),
      JSON.stringify([]),
      nextVersion,
    ],
  )

  // Audit (invariant 18): who changed config, before → after.
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
      JSON.stringify({ kind_name: KIND, version: nextVersion, transitions: rules }),
      ctx.actorId,
    ],
  )

  return { workflowDefinitionId: newId, version: nextVersion, rules }
})
