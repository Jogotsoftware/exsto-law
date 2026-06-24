// Author the founder's 5-step NC SMLLC workflow onto its service (ADR 0045, PR4a).
//
// Puts NC_SMLLC_AUTHORED (the 5-stage intake → consultation → review → invoice →
// closed lifecycle) onto the nc_single_member_llc_formation service via
// legal.service.set_lifecycle. The handler validates the graph and writes a new
// immutable workflow_definition version with the graph in states, carrying the
// service's metadata/transitions forward unchanged.
//
// ⚠️ RUN ONCE, BY THE MERGE MANAGER, AGAINST PROD — and only AFTER #206 / this PR
//    is merged AND migration 0094 is applied (the action kind must exist). This is
//    NOT to be run from a feature branch (parallel-session hygiene #203). It is
//    idempotent in EFFECT only in that re-running it simply authors another
//    identical version; prefer running it exactly once.
//
// Run: pnpm --filter @exsto/legal exec tsx --env-file=../../.env.local demo/author-smllc-workflow.ts
//   (or from repo root: tsx --env-file=.env.local verticals/legal/demo/author-smllc-workflow.ts)
import { closeDbPool } from '@exsto/shared'
import { setServiceLifecycle, type ActionContext } from '@exsto/legal'
import { NC_SMLLC_AUTHORED } from '@exsto/legal'
// Side-effect import: registers the legal action handlers so submitAction can dispatch.
import '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const OWNER_ACTOR_ID = '00000000-0000-0000-0001-000000000004' // Claude agent actor — set_lifecycle is the agent-sourced authoring path (PR5); humans lack the action scope for the freshly-seeded kind
const SERVICE_KEY = 'nc_single_member_llc_formation'

const ctx: ActionContext = { tenantId: TENANT_ID, actorId: OWNER_ACTOR_ID }

async function main(): Promise<void> {
  console.log(`Authoring the 5-step NC SMLLC workflow onto "${SERVICE_KEY}" as Juan Carlos.\n`)
  const res = await setServiceLifecycle(ctx, SERVICE_KEY, NC_SMLLC_AUTHORED)
  console.log('✓ Lifecycle authored.')
  console.log(
    JSON.stringify(
      {
        serviceKey: res.serviceKey,
        version: res.version,
        workflowDefinitionId: res.workflowDefinitionId,
        stages: NC_SMLLC_AUTHORED.map((s) => s.key),
      },
      null,
      2,
    ),
  )
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('✗ Authoring failed:', error)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
