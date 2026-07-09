// CAPABILITY-UNIFY-1 — rescue a matter whose legal.capability.run job dead-lettered
// before the will drafting-prompt fix: enqueue a FRESH job for the same matter+stage
// (the worker re-resolves the current stage; draft-exists idempotency makes this safe).
//   node --import tsx --env-file=.env.local verticals/legal/demo/capunify-rescue.ts <matter_entity_id>
import '@exsto/legal'
import { enqueueCapabilityRunJob } from '@exsto/legal'
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }

async function main(): Promise<void> {
  const matterEntityId = process.argv[2]
  if (!matterEntityId) throw new Error('usage: capunify-rescue.ts <matter_entity_id>')
  const state = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ current_state: string }>(
      `SELECT current_state FROM workflow_instance WHERE tenant_id=$1 AND subject_entity_id=$2 ORDER BY started_at DESC LIMIT 1`,
      [TENANT, matterEntityId],
    )
    return r.rows[0]?.current_state
  })
  if (!state) throw new Error(`No workflow instance for ${matterEntityId}`)
  const jobId = await enqueueCapabilityRunJob(ctx, matterEntityId, state)
  console.log(`re-enqueued ${matterEntityId} at ${state}: job ${jobId}`)

  const deadline = Date.now() + 4 * 60 * 1000
  let last = ''
  while (Date.now() < deadline) {
    const row = await withActionContext(ctx, async (client) => {
      const r = await client.query<{ status: string; current_state: string }>(
        `SELECT wj.status, wi.current_state
           FROM worker_job wj, workflow_instance wi
          WHERE wj.id=$1 AND wi.tenant_id=$2 AND wi.subject_entity_id=$3`,
        [jobId, TENANT, matterEntityId],
      )
      return r.rows[0]
    })
    const line = `job=${row?.status} state=${row?.current_state}`
    if (line !== last) console.log(`[poll] ${line}`)
    last = line
    if (row?.status === 'succeeded' || row?.status === 'dead_letter') break
    await new Promise((r) => setTimeout(r, 5000))
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
