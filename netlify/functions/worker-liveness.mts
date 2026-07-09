// Worker liveness detector — a Netlify SCHEDULED function.
//
// This is the whole point of running it here: it executes on Netlify's cron, a
// DIFFERENT platform from the Render "exsto-law-worker" service, so it can report
// the worker's death even when the worker (or all of Render) is down. A dead
// worker cannot report its own death, so this must NOT live in workers/runtime.
//
// It does one read-only query over the job queue, decides health with the PURE
// evaluateLiveness() (unit-tested, no DB), and on an unhealthy verdict sends an
// alert through a channel that does NOT depend on the worker or the job queue:
// a direct transactional-email POST, plus a log line (logs are independent too).
//
// Env:
//   ALERT_DATABASE_URL   owner / RLS-bypassing Postgres URL. Worker death is
//                        cross-tenant, so this must see ALL tenants' jobs — a
//                        non-owner (RLS) connection with no app.tenant_id set
//                        sees zero rows. Falls back to DATABASE_URL.
//   ALERT_EMAIL_API_KEY  transactional-email provider key (Resend by default)
//   ALERT_EMAIL_FROM     verified sender address
//   ALERT_EMAIL_TO       recipient(s), comma-separated
//   ALERT_EMAIL_ENDPOINT optional provider URL override (default Resend)
//   WORKER_LIVENESS_PENDING_THRESHOLD_SEC / _RUNNING_THRESHOLD_SEC  optional tuning
import { Client } from 'pg'
import {
  LIVENESS_SQL,
  evaluateLiveness,
  formatAlert,
  buildAlertEmailRequest,
  DEFAULT_LIVENESS_THRESHOLDS,
  type LivenessRow,
} from '@exsto/worker-runtime/liveness'

export const config = { schedule: '*/5 * * * *' }

// Treat empty / whitespace env vars as unset, so an unfilled ALERT_DATABASE_URL
// (e.g. a placeholder in the uploaded .env) falls back to DATABASE_URL instead of
// trying to connect to "".
const nonEmpty = (v: string | undefined): string | undefined => (v && v.trim() ? v : undefined)

function thresholds(): { pendingAgeThresholdSec: number; runningAgeThresholdSec: number } {
  const num = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    pendingAgeThresholdSec: num(
      process.env.WORKER_LIVENESS_PENDING_THRESHOLD_SEC,
      DEFAULT_LIVENESS_THRESHOLDS.pendingAgeThresholdSec,
    ),
    runningAgeThresholdSec: num(
      process.env.WORKER_LIVENESS_RUNNING_THRESHOLD_SEC,
      DEFAULT_LIVENESS_THRESHOLDS.runningAgeThresholdSec,
    ),
  }
}

async function queueSnapshot(connectionString: string): Promise<LivenessRow> {
  const client = new Client({
    connectionString,
    // Supabase requires TLS. Honor an explicit sslmode in the URL; otherwise
    // enable TLS unless we're pointed at a local DB.
    ssl:
      /localhost|127\.0\.0\.1/.test(connectionString) || /sslmode=/.test(connectionString)
        ? undefined
        : { rejectUnauthorized: false },
    // Fail fast rather than hang the scheduled invocation.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  })
  await client.connect()
  try {
    const r = await client.query<LivenessRow>(LIVENESS_SQL)
    return r.rows[0]
  } finally {
    await client.end()
  }
}

export default async (): Promise<Response> => {
  const connectionString =
    nonEmpty(process.env.ALERT_DATABASE_URL) ??
    nonEmpty(process.env.DATABASE_URL) ??
    nonEmpty(process.env.SUPABASE_DATABASE_URL) ??
    nonEmpty(process.env.SUPABASE_DB_URL)
  if (!connectionString) {
    // Can't even check — this is itself an alert-worthy misconfiguration.
    console.error(
      '[worker-liveness] no database URL (set ALERT_DATABASE_URL, owner/RLS-bypassing) — cannot check the worker.',
    )
    return new Response('missing ALERT_DATABASE_URL', { status: 500 })
  }

  let verdict
  try {
    const row = await queueSnapshot(connectionString)
    verdict = evaluateLiveness(row, thresholds())
  } catch (err) {
    console.error('[worker-liveness] queue snapshot query failed:', err)
    return new Response('query failed', { status: 500 })
  }

  if (verdict.healthy) {
    console.log(
      `[worker-liveness] healthy — runnablePending=${verdict.runnablePending} running=${verdict.runningTotal}`,
    )
    return Response.json({ healthy: true, verdict })
  }

  // Unhealthy. The log line is the always-on independent channel; the email is
  // the push on top of it. Neither touches the (possibly dead) worker/queue.
  console.error(`[worker-liveness] UNHEALTHY — ${verdict.reasons.join(' | ')}`)

  const req = buildAlertEmailRequest(process.env, formatAlert(verdict))
  if (!req) {
    console.error(
      '[worker-liveness] alert email not configured (need ALERT_EMAIL_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO) — logged only.',
    )
    return Response.json({ healthy: false, alerted: 'log-only', verdict })
  }

  try {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body })
    if (!res.ok) {
      console.error(`[worker-liveness] alert email POST failed: ${res.status} ${await res.text()}`)
      return Response.json({ healthy: false, alerted: 'email-failed', verdict })
    }
    return Response.json({ healthy: false, alerted: 'email', verdict })
  } catch (err) {
    console.error('[worker-liveness] alert email send threw:', err)
    return Response.json({ healthy: false, alerted: 'email-error', verdict })
  }
}
