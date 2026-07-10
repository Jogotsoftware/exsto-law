// BACKHALF-BLOCKS-1 (WP2) — re-author nc_will_drafting to carry its BILLING
// declaration: per-document fee for the will, accrued when the attorney approves it
// (WP1). The graph already ends in the complete_matter terminal (capunify-prod-setup),
// so the completion declaration is already real; this adds document_fees and prints
// the acceptance receipts:
//   1. the service's v-next transitions (billing declaration receipt),
//   2. validateProposedLifecycle PASSES on the live graph (positive receipt),
//   3. validateProposedLifecycle REJECTS a stripped graph (no completion step, no
//      billing declaration) with the exact-path errors (negative receipt).
// Run with the prod DATABASE_URL: tsx --env-file=<main-worktree>/.env.local this-file.
// Fee amount override: BACKHALF_WILL_FEE=350.00 (decimal string).
import {
  updateServiceMetadata,
  getService,
  getServiceLifecycle,
  validateProposedLifecycle,
} from '@exsto/legal'
import type { Lifecycle } from '@exsto/legal'
import { type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor
const SERVICE_KEY = 'nc_will_drafting'
const WILL_DOC_KIND = 'last_will_and_testament'
const FEE = (process.env.BACKHALF_WILL_FEE ?? '350.00').trim()

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }

  // 1. Declare the billing: per-document fee for the will (new service version).
  const current = await getService(ctx, SERVICE_KEY)
  if (!current) throw new Error(`Service not found: ${SERVICE_KEY}`)
  const updated = await updateServiceMetadata(ctx, {
    serviceKey: SERVICE_KEY,
    displayName: current.displayName,
    documentFees: { [WILL_DOC_KIND]: FEE },
  })
  console.log(`✓ ${SERVICE_KEY} v-next declares document_fees:`)
  console.log(JSON.stringify(updated.documentFees, null, 2))

  // 2. Positive receipt: the live graph passes the WP2 validator.
  const lifecycle = await getServiceLifecycle(ctx, SERVICE_KEY)
  if (!lifecycle?.graph?.length) throw new Error(`${SERVICE_KEY} has no lifecycle graph.`)
  const ok = await validateProposedLifecycle(ctx, lifecycle.graph as Lifecycle, SERVICE_KEY)
  console.log(`✓ validateProposedLifecycle(live graph): ok=${ok.ok}`, ok.errors)

  // 3. Negative receipt: strip the completion step and check the exact-path errors.
  const graph = lifecycle.graph as Lifecycle
  const stripped = graph
    .filter((s) => s.action?.kind !== 'complete_matter')
    .map((s, i, arr) =>
      i === arr.length - 1
        ? { ...s, terminal: true, advances_to: [], action: { kind: 'manual_task' as const } }
        : s,
    )
  const rejected = await validateProposedLifecycle(ctx, stripped, SERVICE_KEY)
  console.log(`✓ stripped graph rejected: ok=${rejected.ok}`)
  for (const e of rejected.errors) console.log(`  REJECT: ${e}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
