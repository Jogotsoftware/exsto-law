// MACHINE-COMMS-1 (WP0.3) — repair a STRANDED matter: one that was opened without
// a workflow instance (the silent-skip class) for a service that HAS an authored
// lifecycle. Runs the SAME action path the matter page's "Start workflow" control
// uses (legal.matter.set_workflow start mode → createWorkflowInstance + a
// workflow.started event), as the given attorney actor.
//
//   npx tsx --env-file=.env.local verticals/legal/demo/repair-stranded-matter.ts <matterId> [--skip-client-gate]
//
// --skip-client-gate additionally advances past the entry stage when it is
// client-gated and the client's delivery already happened before the instance
// existed (the stranded-matter shape): the attorney's deliberate skip via
// skipClientStage (Contract W) — the same affordance the runner offers.
import { pathToFileURL } from 'node:url'
import type { ActionContext } from '@exsto/substrate'
import { startMatterWorkflow, skipClientStage } from '@exsto/legal'
import '@exsto/legal'

const TENANT = '00000000-0000-0000-0000-000000000001'
// Joe's attorney actor (the matter owner in the pilot tenant).
const ATTORNEY = process.env.REPAIR_ACTOR ?? 'e193d11c-9204-4068-8d01-0613ec1a5095'

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const matterId = process.argv[2]
  if (!matterId) throw new Error('usage: repair-stranded-matter.ts <matterId> [--skip-client-gate]')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

  const started = await startMatterWorkflow(ctx, matterId)
  console.log('workflow started:', JSON.stringify(started))

  if (process.argv.includes('--skip-client-gate')) {
    const skipped = await skipClientStage(ctx, matterId)
    console.log('client gate skipped:', JSON.stringify(skipped))
  }
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    })
}
