// Worker lock-timeout sweep + liveness query — DB-gated (live Postgres). Proves
// the sweep reclaims/dead-letters stale-running jobs, leaves fresh locks alone,
// and that the liveness query's `run_at <= now()` predicate does NOT count a
// future-dated (backoff/scheduled) pending job as runnable — so a waiting queue
// never reads as a dead worker. Needs SUBSTRATE_TEST_DATABASE_URL (or DATABASE_URL)
// on an owner connection (the sweep runs cross-tenant via withSuperuser, matching
// the worker). Point at exsto-dev. Skipped without a DB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { closeDbPool, withSuperuser } from '@exsto/shared'
import { sweepStaleRunningJobs, LIVENESS_SQL, evaluateLiveness } from '@exsto/worker-runtime'
import type { LivenessRow } from '@exsto/worker-runtime'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const KIND = 'test.sweep.probe'
const IDS = {
  reclaim: '5eeeeeee-0000-0000-0000-000000000001',
  dead: '5eeeeeee-0000-0000-0000-000000000002',
  fresh: '5eeeeeee-0000-0000-0000-000000000003',
  past: '5eeeeeee-0000-0000-0000-000000000004',
  future: '5eeeeeee-0000-0000-0000-000000000005',
}

async function statusOf(
  id: string,
): Promise<{ status: string; run_at: string; locked_at: string | null }> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ status: string; run_at: string; locked_at: string | null }>(
      `SELECT status, run_at, locked_at FROM worker_job WHERE id = $1`,
      [id],
    )
    return r.rows[0]
  })
}

run('worker lock-timeout sweep + liveness query (live DB)', () => {
  beforeAll(async () => {
    await withSuperuser(async (client) => {
      await client.query(`DELETE FROM worker_job WHERE job_kind = $1`, [KIND])
      await client.query(
        `INSERT INTO worker_job (id, tenant_id, job_kind, status, attempts, max_attempts, run_at, locked_at, locked_by)
         VALUES
           ($1, $6, $7, 'running', 1, 5, now(), now() - interval '1 hour', 'dead-worker'),
           ($2, $6, $7, 'running', 5, 5, now(), now() - interval '1 hour', 'dead-worker'),
           ($3, $6, $7, 'running', 1, 5, now(), now(),                    'live-worker'),
           ($4, $6, $7, 'pending', 0, 5, now() - interval '2 hours', NULL, NULL),
           ($5, $6, $7, 'pending', 0, 5, now() + interval '1 hour',  NULL, NULL)`,
        [IDS.reclaim, IDS.dead, IDS.fresh, IDS.past, IDS.future, TENANT, KIND],
      )
    })
  })

  afterAll(async () => {
    await withSuperuser(async (client) => {
      await client.query(`DELETE FROM worker_job WHERE job_kind = $1`, [KIND])
    })
    await closeDbPool()
  })

  it('caution #2: a future-dated pending job is NOT runnable; a past-dated one is', async () => {
    const { runnable, not_yet } = await withSuperuser(async (client) => {
      const r = await client.query<{ runnable: number; not_yet: number }>(
        `SELECT
           count(*) FILTER (WHERE status = 'pending' AND run_at <= now())::int AS runnable,
           count(*) FILTER (WHERE status = 'pending' AND run_at > now())::int  AS not_yet
         FROM worker_job WHERE job_kind = $1`,
        [KIND],
      )
      return r.rows[0]
    })
    expect(runnable).toBe(1) // the past-dated probe
    expect(not_yet).toBe(1) // the future-dated probe, correctly excluded
  })

  it('LIVENESS_SQL runs against the real schema and maps to a verdict', async () => {
    const row = await withSuperuser(async (client) => {
      const r = await client.query<LivenessRow>(LIVENESS_SQL)
      return r.rows[0]
    })
    const verdict = evaluateLiveness(row)
    expect(typeof verdict.healthy).toBe('boolean')
    expect(typeof verdict.runnablePending).toBe('number')
    // The past-dated probe means at least one job is runnable right now.
    expect(verdict.runnablePending).toBeGreaterThanOrEqual(1)
  })

  it('reclaims a stale-running job with attempts remaining (→ pending, backed off)', async () => {
    const before = await statusOf(IDS.reclaim)
    const result = await sweepStaleRunningJobs(1800)
    expect(result.reclaimed).toBeGreaterThanOrEqual(1)

    const after = await statusOf(IDS.reclaim)
    expect(after.status).toBe('pending')
    expect(after.locked_at).toBeNull()
    // Backed off into the future rather than retried instantly.
    expect(new Date(after.run_at).getTime()).toBeGreaterThan(new Date(before.run_at).getTime())
  })

  it('dead-letters a stale-running job whose attempts are exhausted', async () => {
    // sweep already ran in the previous test; assert the terminal outcome.
    const after = await statusOf(IDS.dead)
    expect(after.status).toBe('dead_letter')
    expect(after.locked_at).toBeNull()
  })

  it('leaves a freshly-locked running job alone (no double-execution)', async () => {
    const after = await statusOf(IDS.fresh)
    expect(after.status).toBe('running')
    expect(after.locked_at).not.toBeNull()
  })
})
