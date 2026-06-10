// Postgres-backed job queue. At-least-once delivery via FOR UPDATE SKIP LOCKED
// claim; time-based scheduling via run_at; retry with exponential backoff;
// dead-letter on attempt exhaustion. Jobs are claimed as the owner role
// (withSuperuser) since the worker spans tenants; the dispatcher binds
// app.tenant_id per job before running the handler.
import { withSuperuser, withTenant } from '@exsto/shared'

export interface EnqueueJobInput {
  tenantId: string
  jobKind: string
  payload?: Record<string, unknown>
  runAt?: Date // schedule for the future; defaults to now
  priority?: number
  maxAttempts?: number
}

// Enqueue runs tenant-scoped through RLS (apps enqueue inside their tenant ctx).
export async function enqueueJob(input: EnqueueJobInput): Promise<string> {
  return withTenant(input.tenantId, async (client) => {
    const r = await client.query<{ id: string }>(
      `INSERT INTO worker_job (tenant_id, job_kind, payload, run_at, priority, max_attempts)
       VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, now()), $5, $6)
       RETURNING id`,
      [
        input.tenantId,
        input.jobKind,
        JSON.stringify(input.payload ?? {}),
        input.runAt ? input.runAt.toISOString() : null,
        input.priority ?? 0,
        input.maxAttempts ?? 5,
      ],
    )
    return r.rows[0]!.id
  })
}

export interface ClaimedJob {
  id: string
  tenantId: string
  jobKind: string
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
}

// Atomically claim the next ready job (status=pending, run_at<=now). Increments
// attempts at claim time so a crashed worker still consumes an attempt.
export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  return withSuperuser(async (client) => {
    const r = await client.query<{
      id: string
      tenant_id: string
      job_kind: string
      payload: Record<string, unknown>
      attempts: number
      max_attempts: number
    }>(
      `UPDATE worker_job
          SET status = 'running', attempts = attempts + 1,
              locked_at = now(), locked_by = $1, updated_at = now()
        WHERE id = (
          SELECT id FROM worker_job
           WHERE status = 'pending' AND run_at <= now()
           ORDER BY priority DESC, run_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id, tenant_id, job_kind, payload, attempts, max_attempts`,
      [workerId],
    )
    const row = r.rows[0]
    if (!row) return null
    return {
      id: row.id,
      tenantId: row.tenant_id,
      jobKind: row.job_kind,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    }
  })
}

export async function completeJob(jobId: string): Promise<void> {
  await withSuperuser(async (client) => {
    await client.query(
      `UPDATE worker_job SET status = 'succeeded', last_error = NULL, updated_at = now() WHERE id = $1`,
      [jobId],
    )
  })
}

const BACKOFF_BASE_SECONDS = 2
const BACKOFF_CAP_SECONDS = 3600

export function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attempts - 1))
}

// Reschedule with exponential backoff, or move to the dead-letter queue once
// attempts are exhausted.
export async function failJob(
  jobId: string,
  attempts: number,
  maxAttempts: number,
  error: string,
): Promise<'retry' | 'dead_letter'> {
  const decision: 'retry' | 'dead_letter' = attempts >= maxAttempts ? 'dead_letter' : 'retry'
  await withSuperuser(async (client) => {
    if (decision === 'dead_letter') {
      await client.query(
        `UPDATE worker_job SET status = 'dead_letter', last_error = $2, updated_at = now() WHERE id = $1`,
        [jobId, error],
      )
    } else {
      await client.query(
        `UPDATE worker_job
            SET status = 'pending', last_error = $2,
                run_at = now() + ($3 || ' seconds')::interval,
                locked_at = NULL, locked_by = NULL, updated_at = now()
          WHERE id = $1`,
        [jobId, error, String(backoffSeconds(attempts))],
      )
    }
  })
  return decision
}
