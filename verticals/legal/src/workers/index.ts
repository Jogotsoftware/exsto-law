// Vertical worker handlers (registered from the vertical — the core
// workers/runtime package stays untouched, ADR 0043). The dispatcher binds
// tenant context + the per-tenant system actor before invoking handlers.
import { registerWorkerHandler, enqueueJob } from '@exsto/worker-runtime'
import { withTenant } from '@exsto/shared'
import { runGranolaProjection } from '../api/granolaIngestion.js'

// How often the calendar reconciliation pass re-reads Google (default 6h).
const RECONCILE_INTERVAL_MS = Number(
  process.env.MEETING_RECONCILE_INTERVAL_MS ?? 6 * 60 * 60 * 1000,
)

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
  const p = payload as { matter_entity_id: string; document_kind: string }
  await runDraftGeneration(ctx, {
    matterEntityId: p.matter_entity_id,
    documentKind: p.document_kind,
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
registerWorkerHandler('legal.meeting.reconcile', async (ctx) => {
  try {
    const { reconcileAllMeetings } = await import('../api/meetings.js')
    const summary = await reconcileAllMeetings(ctx)
    console.log(
      `[meeting.reconcile] checked=${summary.checked} updated=${summary.updated} cancelled=${summary.cancelled} skipped=${summary.skipped}`,
    )
  } finally {
    // Always queue the next pass, even if this one threw, so the chain survives.
    await enqueueJob({
      tenantId: ctx.tenantId,
      jobKind: 'legal.meeting.reconcile',
      runAt: new Date(Date.now() + RECONCILE_INTERVAL_MS),
    })
  }
})

// Seed the FIRST reconcile pass at worker startup — idempotent: it no-ops when a
// reconcile job is already pending/running, so restarts never spawn a second
// self-perpetuating chain. Call once from the worker entrypoint.
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
