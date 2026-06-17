// Retire leftover test-fixture services (Objective 12) — THROUGH THE CORE.
//
// tests/vertical/service-library.test.ts creates services with random per-run
// keys (PR1/PR2/PR3/PR4…). Run against a live DB they were never torn down, so
// ~200 deprecated rows linger in workflow_definition. This seals each via the
// legal.service.retire action (valid_to set, no successor) so they leave every
// listing while history is preserved. The three real seeded services are kept.
//
// Run with the pilot DB url:  tsx --env-file=.env.local verticals/legal/demo/retire-test-services.ts
// Idempotent: a service with no current row (already retired) is skipped.
import { closeDbPool } from '@exsto/shared'
import { listServicesIncludingInactive, retireService } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
// Side-effect import: registers the legal action handlers (legal.service.retire).
import '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0001-000000000001'
const systemCtx: ActionContext = { tenantId: TENANT_ID, actorId: SYSTEM_ACTOR_ID }

// The real, seeded services — never retire these.
const KEEP = new Set(['nc_llc_single_member', 'nc_llc_multi_member', 'something_else'])

async function main() {
  const services = await listServicesIncludingInactive(systemCtx)
  const targets = services.filter((s) => !KEEP.has(s.serviceKey))
  console.log(`Found ${services.length} current services; ${targets.length} to retire, keeping:`, [
    ...KEEP,
  ])

  let retired = 0
  for (const svc of targets) {
    try {
      await retireService(systemCtx, svc.serviceKey)
      retired += 1
      if (retired % 25 === 0) console.log(`  retired ${retired}/${targets.length}…`)
    } catch (err) {
      console.error(
        `  failed to retire ${svc.serviceKey}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  const remaining = await listServicesIncludingInactive(systemCtx)
  console.log(`Done. Retired ${retired}. Current services now: ${remaining.length}`)
  console.log('Remaining:', remaining.map((s) => s.serviceKey).sort())
  await closeDbPool()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
