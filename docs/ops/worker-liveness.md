# Worker liveness — detecting (and recovering from) a dead background worker

## Why this exists

The background worker (`docs/ops/worker-deploy.md`, the Render `exsto-law-worker`
service) is a single always-on process that drains the `worker_job` queue. Two
things can go wrong quietly:

1. **A job gets stranded.** The worker claims a job (marks it `running`, sets
   `locked_at`) and then crashes mid-run — a deploy, an OOM, a panic. The claim
   path only ever looks at `status='pending'`, so that row sits in `running`
   forever and never retries. The matter behind it hangs with no draft and no
   failure.

2. **The whole worker dies and doesn't come back.** Bad deploy, exhausted plan,
   Render incident. Nothing drains the queue and nobody knows until a client
   notices their document never arrived.

This adds two independent mechanisms, one for each:

| Problem | Mechanism | Where it runs |
|---------|-----------|---------------|
| Stranded job | **Lock-timeout sweep** | *In* the worker (self-heal) |
| Dead worker | **Liveness detector** | *Off* the worker (Netlify cron) |

## 1. The lock-timeout sweep (self-heal)

`sweepStaleRunningJobs()` in `workers/runtime/src/queue.ts`, called on a cadence
from the worker poll loop. Every `WORKER_SWEEP_INTERVAL_MS` (default 60s) it
reclaims any job whose lock is older than `WORKER_LOCK_TIMEOUT_SEC` (default
**1800s / 30m**) and routes it through the same decision a thrown handler gets:
retry with backoff, or dead-letter once `attempts` are spent. A sweep also runs
immediately at boot, so a job stranded by the previous instance's crash recovers
as soon as the worker restarts.

**Why 30 minutes and not less.** The threshold must be larger than the longest
job the worker legitimately runs. With one worker, a real ~5-minute drafting job
holds its lock the whole time; if the timeout were below that, the sweep would
reclaim a job that is *still running* and cause a second, concurrent execution.
30m matches the existing `resolveStaleDraftJobs` stale window and sits well above
any model call. If you ever add a genuinely long job, raise this.

> Behavior change worth knowing: before this, a stalled `legal.draft.run` job
> stayed `running` forever and `resolveStaleDraftJobs` only surfaced it as a
> `draft.failed` (retryable) event for the UI — a human had to retry. Now the
> sweep reclaims the row and the runtime **auto-retries** it (up to `max_attempts`,
> then dead-letters). That matches the `retryable: true` intent already on those
> events. The queue is at-least-once, so handlers already tolerate a re-run.

## 2. The liveness detector (external alarm)

`netlify/functions/worker-liveness.mts` — a **Netlify scheduled function**, runs
every 5 minutes. It is deliberately **not** part of the worker: a dead worker
can't report its own death, so the detector runs on a different platform
(Netlify's cron) that stays up when Render is down.

It runs one read-only query (`LIVENESS_SQL`, in `workers/runtime/src/liveness.ts`)
and decides health with the pure, unit-tested `evaluateLiveness()`. The signal is
**age of runnable work**, not "no job succeeded recently" (which would false-alarm
on an idle queue):

- **oldest runnable pending job** — a job that is eligible to run *right now*
  (`status='pending' AND run_at <= now()`) but hasn't been claimed. A future-dated
  job (backoff or scheduled) is not runnable yet and is excluded. Alerts past
  `WORKER_LIVENESS_PENDING_THRESHOLD_SEC` (default 600s).
- **oldest stuck running job** — claimed but sitting in `running` far too long.
  Alerts past `WORKER_LIVENESS_RUNNING_THRESHOLD_SEC` (default 1800s).

An idle queue → both null → healthy → silent.

### The alert channel is independent too

On an unhealthy verdict the function (a) always logs (Netlify function logs are
independent of the worker), and (b) sends an email via a **direct
transactional-email POST** (`buildAlertEmailRequest`, Resend-shaped by default).
This deliberately does **not** use the Gmail adapter (per-tenant OAuth + DB, and
heavy to bundle) and **never** enqueues a `worker_job` — if the alert rode the
same queue that's dead, it would never fire.

## Configuration (Netlify site env)

The detector needs these set on the **Netlify** site (not Render):

| Var | Purpose |
|-----|---------|
| `ALERT_DATABASE_URL` | Owner / RLS-bypassing Postgres URL. Must see **all** tenants' jobs — a non-owner URL with no tenant context set sees zero rows. Falls back to `DATABASE_URL`. |
| `ALERT_EMAIL_API_KEY` | Transactional-email provider key (e.g. Resend `re_…`). |
| `ALERT_EMAIL_FROM` | Verified sender address. |
| `ALERT_EMAIL_TO` | Recipient(s), comma-separated. |
| `ALERT_EMAIL_ENDPOINT` | Optional — override the provider URL (any provider taking `{from,to,subject,text}` + `Authorization: Bearer`). |
| `WORKER_LIVENESS_PENDING_THRESHOLD_SEC` / `_RUNNING_THRESHOLD_SEC` | Optional tuning. |

Until the three `ALERT_EMAIL_*` are set, the detector runs and **logs** but sends
no email. That is a safe partial deployment: the check works, you just read it in
the function logs.

The sweep needs nothing new on Render — it uses defaults. Override
`WORKER_LOCK_TIMEOUT_SEC` / `WORKER_SWEEP_INTERVAL_MS` there if desired.

## Deploy checklist

1. Merge — Netlify picks up `netlify/functions/worker-liveness.mts` (the
   `[functions]` block in `netlify.toml`) and registers the `*/5 * * * *` schedule.
2. Set `ALERT_DATABASE_URL` (owner URL) on the Netlify site. Confirm cross-tenant
   visibility: the query must not be RLS-scoped to one tenant.
3. Provision a transactional-email sender (Resend is simplest) and set the three
   `ALERT_EMAIL_*` vars.
4. Verify: Netlify ▸ Functions ▸ `worker-liveness` ▸ **Run** — a healthy queue
   returns `{ healthy: true }`; the logs show the snapshot line.

## Verify (locally / CI)

- Pure logic: `pnpm test` runs `tests/invariants/worker-liveness.test.ts`
  (idle-is-healthy, age-thresholds, alert formatting, email-request builder) with
  no DB.
- Sweep + query against a real schema:
  `SUBSTRATE_TEST_DATABASE_URL=<owner url> pnpm test` runs
  `tests/invariants/worker-sweep.test.ts` (reclaim/dead-letter/leave-fresh, and
  the `run_at <= now()` predicate that keeps a waiting queue from reading as dead).
