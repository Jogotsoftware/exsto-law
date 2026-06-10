import { withTenant, withSuperuser, withSpan } from '@exsto/shared'
import { claimNextJob, completeJob, failJob } from './queue.js'
import { getWorkerHandler } from './handlers/index.js'
import { recordJobResult } from './telemetry.js'

// Per-tenant system actor id, resolved once and cached. Worker handlers run as
// the tenant's system actor so any actions they submit carry a valid actor
// (invariant 9).
const systemActorCache = new Map<string, string>()

async function resolveSystemActor(tenantId: string): Promise<string> {
  const cached = systemActorCache.get(tenantId)
  if (cached) return cached
  const id = await withSuperuser(async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM actor WHERE tenant_id = $1 AND actor_type = 'system' AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    )
    return r.rows[0]?.id ?? null
  })
  if (!id) throw new Error(`No system actor for tenant ${tenantId}`)
  systemActorCache.set(tenantId, id)
  return id
}

// Claim and run the next ready job. Returns false when the queue is empty so the
// poll loop can back off. Tenant context is bound before the handler runs (DoD).
export async function dispatchNextJob(workerId = 'worker-1'): Promise<boolean> {
  const job = await claimNextJob(workerId)
  if (!job) return false

  const started = Date.now()
  const handler = getWorkerHandler(job.jobKind)

  if (!handler) {
    const decision = await failJob(
      job.id,
      job.attempts,
      job.maxAttempts,
      `No handler for job kind: ${job.jobKind}`,
    )
    recordJobResult(job.jobKind, 'failed', Date.now() - started)
    console.warn(`Job ${job.id} (${job.jobKind}) has no handler -> ${decision}`)
    return true
  }

  try {
    const actorId = await resolveSystemActor(job.tenantId)
    await withSpan(
      'worker.job',
      () =>
        withTenant(
          job.tenantId,
          async () => {
            await handler({ tenantId: job.tenantId, actorId }, job.payload)
          },
          { actorId },
        ),
      { 'exsto.job_kind': job.jobKind, 'exsto.tenant_id': job.tenantId },
    )
    await completeJob(job.id)
    recordJobResult(job.jobKind, 'succeeded', Date.now() - started)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const decision = await failJob(job.id, job.attempts, job.maxAttempts, message)
    recordJobResult(job.jobKind, 'failed', Date.now() - started)
    console.error(
      `Job ${job.id} (${job.jobKind}) failed [attempt ${job.attempts}/${job.maxAttempts}] -> ${decision}: ${message}`,
    )
  }
  return true
}
