// WF-FIX-1 (WP6) — stall recovery parity for capability runs. Drafting jobs got a
// reconcile sweep in PROD-DRAFT-OFFLOAD (generateDraft.resolveStaleDraftJobs →
// draft.failed); `legal.capability.run` jobs had NOTHING vertical-side — a worker
// crash mid-capability left the job 'running' forever and the matter's Workflow
// window spinning "Running on the worker…" with no recorded failure to show. This
// sibling sweep surfaces each stalled capability job as a queryable
// `capability_run_stalled` observation on the matter, which the CapabilityStatePanel
// reads (legal.matter.history) to show an honest failed state + Run-again.
//
// Same deliberate ONE-SHOT-per-boot cadence as the draft sweep: the observation is
// emitted without transitioning the stuck job, so a recurring pass would re-emit the
// same stall every interval. Each merge auto-deploys and restarts the worker, which
// is often enough.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

export interface StaleCapabilityJob {
  matterEntityId: string
  jobId: string
  stageKey: string
}

export async function resolveStaleCapabilityJobs(
  ctx: ActionContext,
  staleMinutes = 30,
): Promise<StaleCapabilityJob[]> {
  const stale = await withActionContext(ctx, async (client) => {
    // A "stuck" capability job is one CLAIMED (status='running', locked_at set)
    // whose worker died before reaching a terminal state. Pending jobs are
    // waiting/backing off (the queue retries them); dead_letter is terminal.
    const res = await client.query<{
      id: string
      payload: { matter_entity_id?: string; stage_key?: string }
    }>(
      `SELECT id, payload FROM worker_job
       WHERE tenant_id = $1
         AND job_kind = 'legal.capability.run'
         AND status = 'running'
         AND locked_at < now() - ($2 || ' minutes')::interval`,
      [ctx.tenantId, String(staleMinutes)],
    )
    return res.rows
  })

  const resolved: StaleCapabilityJob[] = []
  for (const job of stale) {
    const matterEntityId = job.payload?.matter_entity_id
    const stageKey = job.payload?.stage_key ?? 'unknown'
    if (!matterEntityId) continue
    await submitAction(ctx, {
      actionKindName: 'event.record',
      intentKind: 'automatic_sync',
      payload: {
        event_kind_name: 'observation',
        primary_entity_id: matterEntityId,
        data: {
          kind: 'capability_run_stalled',
          stage: stageKey,
          job_id: job.id,
          reason: `Capability job ${job.id} stalled beyond ${staleMinutes}m without completing.`,
          retryable: true,
        },
        source_type: 'system',
      },
    })
    resolved.push({ matterEntityId, jobId: job.id, stageKey })
  }
  return resolved
}
