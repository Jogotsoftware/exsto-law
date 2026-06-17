# Deploying the background worker (Obj 7b)

## Why this exists

The Pacheco Law app runs on Netlify as a Next.js app. Netlify functions are
**serverless** — they spin up to handle one request and then stop. Some work
can't run that way:

- **AI document drafting** takes ~30s+ and runs after a consultation. That's too
  long for a serverless function and it shouldn't block a web request.
- **Granola call projection** happens when a webhook arrives and needs to fetch a
  transcript and write it into the substrate.
- **Email notifications** are queued and delivered out-of-band.

These run on a **worker**: a small program that sits running all the time,
watches a job queue (the `worker_job` table in Supabase), and processes jobs as
they appear. The code already exists (`verticals/legal/dist/worker.js`); this
doc is how to run it in production as a dedicated always-on service.

> Until this worker is deployed, auto-drafting and queued notifications will sit
> in the queue unprocessed. The attorney can still draft manually from the matter
> page in the meantime.

## What the worker does

On startup it registers three job handlers and then polls the queue:

| Job kind | What it does |
|----------|--------------|
| `legal.granola.project` | Projects a Granola call into a call_session + transcript |
| `legal.draft.run` | Runs async AI drafting (calls Claude) for an auto-route matter |
| `legal.notify` | Delivers a queued notification (email) |

It handles `SIGTERM`/`SIGINT` for clean shutdown (closes the DB pool), retries
failed jobs with exponential backoff, and dead-letters a job after its attempts
are exhausted.

## Deploy on Render (simplest — uses the committed blueprint)

1. Push this repo to GitHub (already done).
2. On [render.com](https://render.com): **New → Blueprint**, pick this repo.
   Render reads [`render.yaml`](../../render.yaml) and creates a **worker**
   service named `exsto-law-worker` built from
   [`Dockerfile.worker`](../../Dockerfile.worker).
3. In the service's **Environment** tab, set the one secret:
   - `DATABASE_URL` — the Supabase Postgres connection string (see below).
   `SUBSTRATE_DB_ROLE=authenticated` and `WORKER_IDLE_POLL_MS=2000` are already
   set by the blueprint.
4. Deploy. The logs should show the worker start and then idle-poll.

## Deploy on Fly.io or Railway (alternative)

Both run the same `Dockerfile.worker`:

- **Fly**: `fly launch --dockerfile Dockerfile.worker --no-deploy`, then
  `fly secrets set DATABASE_URL=… SUBSTRATE_DB_ROLE=authenticated`, then
  `fly deploy`. Set the process to run (no public ports needed).
- **Railway**: New service → Deploy from repo → set Dockerfile path to
  `Dockerfile.worker`, add the same env vars, deploy.

## The DATABASE_URL — use a non-owner role

Row-level security (tenant isolation) is enforced by Postgres **only when the
connection is a non-owner role**. If the worker connects as the database owner,
RLS is silently bypassed — a correctness/security problem.

Two safe options:

1. Point `DATABASE_URL` at Supabase's **pooled connection** for the
   `authenticated` role (Supabase dashboard → Project Settings → Database →
   Connection string → "Connection pooling"). **Recommended.**
2. Or keep `SUBSTRATE_DB_ROLE=authenticated` (set by the blueprint): the worker
   connects, then drops to the `authenticated` role before any query.

Never commit `DATABASE_URL` — set it in the platform's secret store. The image's
`.dockerignore` excludes all `.env` files so they can't leak into the build.

## Verifying it works

- The service logs show repeated idle polls when the queue is empty.
- Trigger a job (e.g. an auto-route consultation completes, or a notification is
  queued) and watch the log process it.
- Check the queue directly in Supabase:
  ```sql
  select job_kind, status, count(*)
  from worker_job
  group by 1, 2 order by 1;
  ```
  Healthy steady state: jobs reach `succeeded`; nothing stuck in `running` or
  piling up in `pending`; `dead_letter` rows are the ones to investigate.

## Local development

Unchanged: `pnpm dev:worker` runs the same entrypoint with
`node --env-file=.env.local`. The production image just runs
`node verticals/legal/dist/worker.js` with env injected by the platform
(equivalently, `pnpm start:worker`).
