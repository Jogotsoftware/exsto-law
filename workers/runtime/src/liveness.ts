// Worker liveness detection — the queue-health query plus its PURE evaluation.
//
// ─── WHY THIS LIVES HERE BUT THE WORKER MUST NEVER RUN IT ───────────────────
// A dead worker cannot report its own death. The liveness check therefore has to
// execute in a SEPARATE process on a SEPARATE platform from the worker — here,
// the Netlify scheduled function `netlify/functions/worker-liveness.mts`, which
// imports this module. The worker's own poll loop (src/index.ts / dispatcher.ts)
// MUST NOT call evaluateLiveness(): if the detector rode inside the worker, a
// crashed worker would take the detector down with it and nothing would alert.
//
// This module is a PURE LEAF (no imports at all) so the scheduled function can
// bundle it without dragging in the pg pool, the action layer, or the tracing
// stack. Everything IO — the DB connection, the outbound alert — lives in the
// function shell; everything decidable lives here, and is unit-tested with no DB.
// ────────────────────────────────────────────────────────────────────────────

// One aggregate read over the whole queue (all tenants — worker death is
// cross-tenant, so the detector connects on an owner / RLS-bypassing role).
//
// The signal is AGE OF RUNNABLE WORK, deliberately not "no job succeeded lately":
//   • oldest_pending_age_sec — how long the oldest job that is *eligible to run
//     right now* (status='pending' AND run_at<=now()) has gone unclaimed. A live
//     worker drains these within seconds. A future-dated pending job (backoff or
//     scheduled) is NOT runnable yet, so it is excluded and never triggers.
//   • oldest_running_age_sec — how long the oldest CLAIMED job has been stuck in
//     'running'. A live worker either completes or fails a job; one that sits in
//     'running' for ages means the worker died mid-job (and the in-dispatcher
//     lock-timeout sweep is not clearing it either).
// An IDLE queue (nothing runnable, nothing running) yields NULLs on both, which
// evaluate to healthy — so idleness never false-alarms.
export const LIVENESS_SQL = `
  SELECT
    count(*) FILTER (WHERE status = 'pending' AND run_at <= now())::int
      AS runnable_pending,
    EXTRACT(EPOCH FROM now() - min(run_at) FILTER (WHERE status = 'pending' AND run_at <= now()))::float8
      AS oldest_pending_age_sec,
    count(*) FILTER (WHERE status = 'running')::int
      AS running_total,
    EXTRACT(EPOCH FROM now() - min(locked_at) FILTER (WHERE status = 'running'))::float8
      AS oldest_running_age_sec
  FROM worker_job
`

// The single row LIVENESS_SQL returns. Age columns are NULL when their bucket is
// empty (no runnable pending / no running jobs).
export interface LivenessRow {
  runnable_pending: number
  oldest_pending_age_sec: number | null
  running_total: number
  oldest_running_age_sec: number | null
}

export interface LivenessThresholds {
  // Alert once a runnable job has waited longer than this. Must exceed the
  // longest single job: with one worker, a legitimately long job (a ~5m draft,
  // maxDuration=300) makes everything queued behind it age while the worker is
  // perfectly alive. 10m sits comfortably above that so a busy worker is not
  // mistaken for a dead one.
  pendingAgeThresholdSec: number
  // Alert once a job has been 'running' longer than this — well past any real
  // job — which means the worker died mid-run. Matches resolveStaleDraftJobs'
  // 30m stale window.
  runningAgeThresholdSec: number
}

export const DEFAULT_LIVENESS_THRESHOLDS: LivenessThresholds = {
  pendingAgeThresholdSec: 600,
  runningAgeThresholdSec: 1800,
}

export interface LivenessVerdict {
  healthy: boolean
  reasons: string[]
  runnablePending: number
  oldestPendingAgeSec: number | null
  runningTotal: number
  oldestRunningAgeSec: number | null
  thresholds: LivenessThresholds
}

// Pure verdict: unhealthy iff some age exceeds its threshold. No IO, no clock —
// the ages are computed in SQL against the DB's now(), so this stays testable.
export function evaluateLiveness(
  row: LivenessRow,
  thresholds: LivenessThresholds = DEFAULT_LIVENESS_THRESHOLDS,
): LivenessVerdict {
  const reasons: string[] = []
  const pendingAge = row.oldest_pending_age_sec
  const runningAge = row.oldest_running_age_sec

  if (pendingAge != null && pendingAge > thresholds.pendingAgeThresholdSec) {
    reasons.push(
      `${row.runnable_pending} runnable job(s) waiting; the oldest has been eligible to run for ` +
        `${formatDuration(pendingAge)} (threshold ${formatDuration(thresholds.pendingAgeThresholdSec)}) — ` +
        `the worker is not draining the queue.`,
    )
  }
  if (runningAge != null && runningAge > thresholds.runningAgeThresholdSec) {
    reasons.push(
      `A job has been stuck in 'running' for ${formatDuration(runningAge)} ` +
        `(threshold ${formatDuration(thresholds.runningAgeThresholdSec)}) — the worker likely died mid-job.`,
    )
  }

  return {
    healthy: reasons.length === 0,
    reasons,
    runnablePending: row.runnable_pending,
    oldestPendingAgeSec: pendingAge,
    runningTotal: row.running_total,
    oldestRunningAgeSec: runningAge,
    thresholds,
  }
}

// Human-readable alert body from a verdict. Kept pure and separate so the
// scheduled function's only job is to send whatever this produces.
export function formatAlert(verdict: LivenessVerdict): { subject: string; text: string } {
  const subject = '[exsto-law] Worker liveness alert — background jobs not draining'
  const text = [
    'The exsto-law background worker (Render service "exsto-law-worker") appears to be down or wedged.',
    '',
    'Signals:',
    ...verdict.reasons.map((r) => `  • ${r}`),
    '',
    'Queue snapshot:',
    `  runnable pending jobs: ${verdict.runnablePending}` +
      (verdict.oldestPendingAgeSec != null
        ? ` (oldest waiting ${formatDuration(verdict.oldestPendingAgeSec)})`
        : ''),
    `  running jobs: ${verdict.runningTotal}` +
      (verdict.oldestRunningAgeSec != null
        ? ` (oldest running ${formatDuration(verdict.oldestRunningAgeSec)})`
        : ''),
    '',
    'What to check: the Render "exsto-law-worker" service — logs, then restart. A',
    'transient crash usually self-heals (the dispatcher reclaims stale locks and',
    'Render restarts the process); a persistent alert means it is not coming back.',
  ].join('\n')
  return { subject, text }
}

export interface AlertEmailRequest {
  url: string
  headers: Record<string, string>
  body: string
}

// PURE builder for the outbound alert email — a direct transactional-email POST
// (Resend-shaped by default), NOT the Gmail adapter and NOT the job queue, so the
// alert path never depends on the very worker it is reporting on. Returns null
// when unconfigured (missing key / from / to) so the caller degrades to log-only.
// ALERT_EMAIL_TO may be a comma-separated list. ALERT_EMAIL_ENDPOINT overrides the
// provider URL for a non-Resend provider with the same {from,to,subject,text} shape.
export function buildAlertEmailRequest(
  env: Record<string, string | undefined>,
  message: { subject: string; text: string },
): AlertEmailRequest | null {
  const apiKey = env.ALERT_EMAIL_API_KEY
  const to = env.ALERT_EMAIL_TO
  const from = env.ALERT_EMAIL_FROM
  if (!apiKey || !to || !from) return null

  const recipients = to
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (recipients.length === 0) return null

  return {
    url: env.ALERT_EMAIL_ENDPOINT ?? 'https://api.resend.com/emails',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: message.subject,
      text: message.text,
    }),
  }
}

// Compact duration for alert copy: "45s", "12m", "1h 30m".
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s}s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`
}
