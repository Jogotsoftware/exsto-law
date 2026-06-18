// WP2.3 receipt — a saved service writes a new immutable version and carries the
// Contract-G generation_mode default ('template_merge'). Non-destructive:
// create → metadata update (version bump) → inspect versions → retire.
//   tsx --env-file=.env.local verticals/legal/demo/verify-service-config.ts
import { closeDbPool } from '@exsto/shared'
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { createService, updateServiceMetadata, retireService } from '@exsto/legal'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000001',
}

async function main() {
  const svc = await createService(ctx, { displayName: 'WP2.3 config check', route: 'manual' })
  await updateServiceMetadata(ctx, {
    serviceKey: svc.serviceKey,
    displayName: 'WP2.3 config check (edited)',
  })

  const rows = await withActionContext(ctx, async (c) => {
    const r = await c.query<{ version: number; active: boolean; gen_mode: string | null }>(
      `SELECT version, valid_to IS NULL AS active, transitions->>'generation_mode' AS gen_mode
       FROM workflow_definition WHERE tenant_id = $1 AND kind_name = $2 ORDER BY version`,
      [ctx.tenantId, svc.serviceKey],
    )
    return r.rows
  })
  console.log('versions:', JSON.stringify(rows))

  const active = rows.find((r) => r.active)
  const priorSealed = rows.filter((r) => !r.active).length >= 1
  const genModeDefault = rows.every((r) => r.gen_mode === 'template_merge')
  const bumped = rows.length >= 2 && active?.version === Math.max(...rows.map((r) => r.version))
  console.log(`ok  version bump (prior sealed, latest active): ${bumped && priorSealed}`)
  console.log(`ok  generation_mode default = template_merge on all versions: ${genModeDefault}`)

  await retireService(ctx, svc.serviceKey)
  const pass = bumped && priorSealed && genModeDefault
  console.log(pass ? 'PASS — versioned save + Contract-G default verified.' : 'FAIL')
  await closeDbPool()
  if (!pass) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
