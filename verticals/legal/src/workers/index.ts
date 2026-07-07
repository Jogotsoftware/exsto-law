// Vertical worker handlers (registered from the vertical — the core
// workers/runtime package stays untouched, ADR 0043). The dispatcher binds
// tenant context + the per-tenant system actor before invoking handlers.
import { registerWorkerHandler, enqueueJob } from '@exsto/worker-runtime'
import { withTenant } from '@exsto/shared'
import { runGranolaProjection } from '../api/granolaIngestion.js'

// How often the calendar reconciliation pass re-reads Google (default 6h).
// Validated at module load so a misconfigured env fails loudly at startup rather
// than throwing 'Invalid time value' inside the re-enqueue (which would stall the
// reconcile chain on every pass).
const RECONCILE_INTERVAL_MS = (() => {
  const raw = process.env.MEETING_RECONCILE_INTERVAL_MS
  if (!raw) return 6 * 60 * 60 * 1000
  const ms = Number(raw)
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`MEETING_RECONCILE_INTERVAL_MS must be a non-negative number, got: "${raw}"`)
  }
  return ms
})()

// Projects a webhook'd (or polled) Granola payload into call_session +
// transcript via call.ingest. Retries/backoff per the worker runtime; the
// projection is idempotent on granola_call_id, so retries are safe.
registerWorkerHandler('legal.granola.project', async (ctx, payload) => {
  await runGranolaProjection(
    ctx,
    payload as { raw_event_log_id?: string | null; payload: Record<string, unknown> },
  )
})

// Runs one async drafting job (Lesson #2: drafting NEVER blocks the attorney
// or the request path). Transient model/API errors throw → runtime backoff.
registerWorkerHandler('legal.draft.run', async (ctx, payload) => {
  const { runDraftGeneration } = await import('../api/generateDraft.js')
  const p = payload as {
    matter_entity_id: string
    document_kind: string
    guidance?: string
    skill_slugs?: string[]
  }
  await runDraftGeneration(ctx, {
    matterEntityId: p.matter_entity_id,
    documentKind: p.document_kind,
    guidance: p.guidance,
    skillSlugs: p.skill_slugs,
  })
})

// Delivers one queued notification through its route's channel driver
// (REQ-NOTIFY-01..03); failures retry with backoff, then dead-letter.
registerWorkerHandler('legal.notify', async (ctx, payload) => {
  const { deliverNotification } = await import('../api/notifications.js')
  const p = payload as { route: string; to: string | null; variables: Record<string, unknown> }
  await deliverNotification(ctx, {
    routeKindName: p.route,
    to: p.to ?? undefined,
    variables: p.variables ?? {},
  })
})

// Periodic calendar reconciliation (Obj 8): re-read each assigned meeting's Google
// event and append corrections (moved/renamed/cancelled). Self-perpetuating — it
// re-enqueues the NEXT pass at the end. ensureMeetingReconcileScheduled (called at
// worker startup) seeds the FIRST one and is idempotent, so a restart never spawns
// a second chain. A Google read error skips that one meeting, not the batch.
//
// The handler CATCHES its own errors (never throws): if it threw, the dispatcher
// would retry this job AND the finally below would queue the next — forking the
// chain on every error. By swallowing + logging, the job always "succeeds" and the
// single re-enqueue keeps exactly one chain. (Per-event Google errors are already
// handled inside reconcileAllMeetings; a throw here would be a systemic failure,
// retried by the next scheduled pass anyway.)
registerWorkerHandler('legal.meeting.reconcile', async (ctx) => {
  try {
    const { reconcileAllMeetings } = await import('../api/meetings.js')
    const summary = await reconcileAllMeetings(ctx)
    console.log(
      `[meeting.reconcile] checked=${summary.checked} updated=${summary.updated} cancelled=${summary.cancelled} skipped=${summary.skipped}`,
    )
  } catch (err) {
    console.error('[meeting.reconcile] pass failed (next pass will retry):', err)
  } finally {
    // Exactly one next pass — the chain continues without a dispatcher retry fork.
    // If the enqueue itself fails (transient DB error), RE-THROW so the dispatcher
    // retries THIS job (re-running the idempotent pass + re-enqueue) rather than
    // letting the chain die silently. The startup bootstrap is the last-resort
    // backstop if it ever dead-letters.
    try {
      await enqueueJob({
        tenantId: ctx.tenantId,
        jobKind: 'legal.meeting.reconcile',
        runAt: new Date(Date.now() + RECONCILE_INTERVAL_MS),
      })
    } catch (err) {
      console.error('[meeting.reconcile] failed to enqueue next pass:', err)
      throw err
    }
  }
})

// Seed the FIRST reconcile pass at worker startup — idempotent: it no-ops when a
// reconcile job is already pending/running, so a restart never spawns a second
// self-perpetuating chain. The check (SELECT count → INSERT) assumes a SINGLE
// worker instance (the Render deploy); two instances starting at the exact same
// moment could both seed — at multi-instance scale, gate this with a unique
// constraint / advisory lock. Call once from the worker entrypoint.
export async function ensureMeetingReconcileScheduled(tenantId: string): Promise<void> {
  const pending = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM worker_job
       WHERE tenant_id = $1 AND job_kind = 'legal.meeting.reconcile' AND status IN ('pending','running')`,
      [tenantId],
    )
    return Number(r.rows[0]?.n ?? '0')
  })
  if (pending > 0) return
  await enqueueJob({ tenantId, jobKind: 'legal.meeting.reconcile', runAt: new Date() })
}

// One-shot recovery sweep for drafting jobs orphaned by a worker crash or a deploy
// mid-run (WP3.4): a job left CLAIMED ('running') with a stale lock never reached a
// terminal state, leaving its matter stuck "generating" with no draft and no
// failure. resolveStaleDraftJobs surfaces each as a retryable draft.failed so it
// stops hanging silently. Errors are swallowed — a recovery sweep must never crash
// the worker boot.
registerWorkerHandler('legal.draft.reconcile', async (ctx) => {
  try {
    const { resolveStaleDraftJobs } = await import('../api/generateDraft.js')
    const resolved = await resolveStaleDraftJobs(ctx)
    if (resolved.length > 0) {
      console.log(
        `[draft.reconcile] surfaced ${resolved.length} stalled drafting job(s): ` +
          resolved.map((r) => r.jobId).join(', '),
      )
    }
  } catch (err) {
    console.error('[draft.reconcile] sweep failed (non-fatal):', err)
  }
})

// Seed ONE recovery sweep at worker startup — idempotent (no-ops if one is already
// pending/running) so a restart never piles them up. Deliberately one-shot per
// boot, NOT a self-perpetuating chain like meeting-reconcile: resolveStaleDraftJobs
// emits draft.failed without transitioning the stuck job, so a recurring pass would
// re-emit the same failure every interval. A boot sweep is the right cadence — each
// merge auto-deploys, restarting the worker often enough to catch orphaned jobs.
export async function ensureStaleDraftReconcileScheduled(tenantId: string): Promise<void> {
  const pending = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM worker_job
       WHERE tenant_id = $1 AND job_kind = 'legal.draft.reconcile' AND status IN ('pending','running')`,
      [tenantId],
    )
    return Number(r.rows[0]?.n ?? '0')
  })
  if (pending > 0) return
  await enqueueJob({ tenantId, jobKind: 'legal.draft.reconcile', runAt: new Date() })
}
