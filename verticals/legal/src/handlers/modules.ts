// Module enablement handlers (ADR 0046 §5). Routed through the action layer so
// every enable/disable/define is an audited action in the tenant it affects
// (invariant 9). These run in the TARGET tenant's context (the control plane
// builds it). The catalog read + any manifest install (permission scopes, kinds)
// is orchestrated by controlPlane/modules.ts via separate submitActions; the
// enable/disable handler records the enablement STATE + the manifest that was
// installed. Disable flips the flag (UI gating) and never deletes data.
import { randomUUID } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'

interface ModuleEnablePayload {
  module_key: string
  manifest?: Record<string, unknown>
  ui_areas?: unknown[]
}

registerActionHandler('legal.module.enable', async (ctx, client: DbClient, payload, actionId) => {
  const p = payload as unknown as ModuleEnablePayload
  if (!p.module_key) throw new Error('module_key is required')
  await client.query(
    `INSERT INTO module_enablement
       (id, tenant_id, action_id, module_key, enabled, installed_manifest, enabled_at)
     VALUES ($1, $2, $3, $4, true, $5::jsonb, now())
     ON CONFLICT (tenant_id, module_key) DO UPDATE
       SET enabled = true,
           action_id = EXCLUDED.action_id,
           installed_manifest = EXCLUDED.installed_manifest,
           enabled_at = now(),
           disabled_at = NULL`,
    [randomUUID(), ctx.tenantId, actionId, p.module_key, JSON.stringify(p.manifest ?? {})],
  )
  return { moduleKey: p.module_key, enabled: true }
})

registerActionHandler('legal.module.disable', async (ctx, client: DbClient, payload, actionId) => {
  const p = payload as unknown as { module_key: string }
  if (!p.module_key) throw new Error('module_key is required')
  await client.query(
    `INSERT INTO module_enablement
       (id, tenant_id, action_id, module_key, enabled, disabled_at)
     VALUES ($1, $2, $3, $4, false, now())
     ON CONFLICT (tenant_id, module_key) DO UPDATE
       SET enabled = false,
           action_id = EXCLUDED.action_id,
           disabled_at = now()`,
    [randomUUID(), ctx.tenantId, actionId, p.module_key],
  )
  return { moduleKey: p.module_key, enabled: false }
})

interface ModuleDefinePayload {
  module_key: string
  display_name: string
  description?: string
  ui_areas?: unknown[]
  requires?: Record<string, unknown>
  depends_on?: unknown[]
}

// Author/update a catalog entry (runs in the platform tenant). Supersedes the
// prior active row with a new version so the catalog history is preserved.
registerActionHandler('legal.module.define', async (ctx, client: DbClient, payload) => {
  const p = payload as unknown as ModuleDefinePayload
  if (!p.module_key || !p.display_name) throw new Error('module_key and display_name are required')
  const prior = await client.query<{ version: number }>(
    `SELECT version FROM module_definition
      WHERE tenant_id = $1 AND module_key = $2 AND valid_to IS NULL
      ORDER BY version DESC LIMIT 1`,
    [ctx.tenantId, p.module_key],
  )
  const nextVersion = (prior.rows[0]?.version ?? 0) + 1
  await client.query(
    `UPDATE module_definition SET valid_to = now()
      WHERE tenant_id = $1 AND module_key = $2 AND valid_to IS NULL`,
    [ctx.tenantId, p.module_key],
  )
  const id = randomUUID()
  await client.query(
    `INSERT INTO module_definition
       (id, tenant_id, module_key, display_name, description, ui_areas, requires, depends_on, version)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
    [
      id,
      ctx.tenantId,
      p.module_key,
      p.display_name,
      p.description ?? null,
      JSON.stringify(p.ui_areas ?? []),
      JSON.stringify(p.requires ?? {}),
      JSON.stringify(p.depends_on ?? []),
      nextVersion,
    ],
  )
  return { moduleDefinitionId: id, moduleKey: p.module_key, version: nextVersion }
})
