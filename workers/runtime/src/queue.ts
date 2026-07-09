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

// One place decides retry-vs-dead-letter: a job that has used up its attempts is
// terminal, otherwise it retries. Shared by failJob (a handler threw) and the
// lock-timeout sweep (a claim never reached any terminal state) so both age out
// a poison job the same way instead of reclaiming it forever.
export function failureDecision(attempts: number, maxAttempts: number): 'retry' | 'dead_letter' {
  return attempts >= maxAttempts ? 'dead_letter' : 'retry'
}

// Reschedule with exponential backoff, or move to the dead-letter queue once
// attempts are exhausted.
export async function failJob(
  jobId: string,
  attempts: number,
  maxAttempts: number,
  error: string,
): Promise<'retry' | 'dead_letter'> {
  const decision = failureDecision(attempts, maxAttempts)
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

export interface SweepResult {
  reclaimed: number
  deadLettered: number
}

// Lock-timeout (visibility-timeout) sweep. claimNextJob only ever looks at
// status='pending', so a job whose worker died mid-run stays 'running' forever
// with a stale lock and never retries — the queue silently loses it. This
// reclaims any job locked longer than timeoutSeconds and routes it through the
// SAME failure decision as a thrown handler: retry with backoff, or dead-letter
// once attempts are spent (attempts was already incremented at claim time, so a
// job that keeps crashing the worker ages out instead of reclaiming forever).
//
// Runs IN the dispatcher/worker (self-heal for the common case: a transient crash
// where Render restarts the process and the reclaimed job is picked up again).
// The EXTERNAL liveness detector (src/liveness.ts, run by the Netlify scheduled
// function) is the backstop for the case this can't cover — a worker that never
// comes back — because a dead worker can't run its own sweep.
//
// One atomic UPDATE across all tenants (owner role, like claimNextJob). The
// backoff arithmetic mirrors backoffSeconds() computed per-row in SQL.
export async function sweepStaleRunningJobs(timeoutSeconds: number): Promise<SweepResult> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ status: 'pending' | 'dead_letter' }>(
      `UPDATE worker_job
          SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
              last_error = $4,
              run_at = CASE
                         WHEN attempts >= max_attempts THEN run_at
                         ELSE now() + make_interval(
                                secs => LEAST($2::float8, $3::float8 * power(2, GREATEST(0, attempts - 1)))
                              )
                       END,
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE status = 'running'
          AND locked_at IS NOT NULL
          AND locked_at < now() - make_interval(secs => $1::float8)
        RETURNING status`,
      [
        timeoutSeconds,
        BACKOFF_CAP_SECONDS,
        BACKOFF_BASE_SECONDS,
        'lock-timeout sweep: reclaimed a job left running past the lock timeout (worker likely crashed mid-job)',
      ],
    )
    let reclaimed = 0
    let deadLettered = 0
    for (const row of r.rows) {
      if (row.status === 'dead_letter') deadLettered += 1
      else reclaimed += 1
    }
    return { reclaimed, deadLettered }
  })
}
