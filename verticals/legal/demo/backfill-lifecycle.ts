// ADR 0045 PR2 — backfill workflow_definition.states for every existing service from
// its current config (route + booking), using deriveLifecycleFromService as the one
// source of truth. SHADOW: nothing reads states until PR3, so this changes no
// behavior; it only populates the data the equality invariant already proved faithful.
//
// DRY-RUN BY DEFAULT (read-only). Pass --apply to write. The write is a one-time
// initialization of an empty `states` (it skips any service whose states is already
// non-empty, so it never clobbers a real edited graph), and is migration-script
// territory (hard rule 1 permits direct writes for migration scripts). User EDITS
// (PR4) version the row through the action layer; this init does not.
//
// Run (dry):   tsx --env-file=.env.local verticals/legal/demo/backfill-lifecycle.ts
// Run (apply): tsx --env-file=.env.local verticals/legal/demo/backfill-lifecycle.ts --apply
import { closeDbPool } from '@exsto/shared'
import { withActionContext, type ActionContext } from '@exsto/substrate'
import {
  listServices,
  deriveLifecycleFromService,
  validateLifecycle,
  automaticEdges,
} from '@exsto/legal'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000004', // Claude (agent/claude), tenant zero
}

const APPLY = process.argv.includes('--apply')

async function main(): Promise<void> {
  const services = await listServices(ctx)
  console.log(
    `${services.length} active services${APPLY ? ' (APPLY mode)' : ' (dry-run — no writes)'}\n`,
  )

  let wouldWrite = 0
  let skippedNonEmpty = 0
  let wrote = 0

  for (const svc of services) {
    const bookingEnabled = svc.booking?.enabled === true
    const lc = deriveLifecycleFromService({ route: svc.route, bookingEnabled })
    const v = validateLifecycle(lc)
    if (!v.ok) {
      console.log(`  ✗ ${svc.serviceKey}: derived graph INVALID — ${v.errors.join('; ')} (skipped)`)
      continue
    }
    const auto =
      automaticEdges(lc)
        .map((e) => `${e.from}→${e.to}`)
        .join(', ') || '(none)'
    console.log(
      `  • ${svc.serviceKey}  route=${svc.route} booking=${bookingEnabled}  ` +
        `${lc.length} stages  automatic: ${auto}`,
    )

    // Read current states to stay idempotent: only initialize an empty one.
    const current = await withActionContext(ctx, async (client) => {
      const res = await client.query<{ states: unknown }>(
        `SELECT states FROM workflow_definition
         WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active' AND valid_to IS NULL`,
        [ctx.tenantId, svc.serviceKey],
      )
      return res.rows[0]?.states
    })
    const isEmpty = !Array.isArray(current) || current.length === 0
    if (!isEmpty) {
      skippedNonEmpty++
      console.log(`      ↳ states already populated — left as-is`)
      continue
    }

    wouldWrite++
    if (!APPLY) continue

    await withActionContext(ctx, async (client) => {
      await client.query(
        `UPDATE workflow_definition SET states = $3::jsonb
         WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active' AND valid_to IS NULL`,
        [ctx.tenantId, svc.serviceKey, JSON.stringify(lc)],
      )
    })
    wrote++
    console.log(`      ↳ states written (${lc.length} stages)`)
  }

  console.log(
    `\n${APPLY ? `Applied: wrote ${wrote}` : `Dry-run: would write ${wouldWrite}`}, ` +
      `skipped ${skippedNonEmpty} already-populated.`,
  )
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error('✗ Backfill failed:', e)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
