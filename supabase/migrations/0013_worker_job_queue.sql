-- =============================================================================
-- Migration 0013: Worker job queue (runtime infrastructure)
-- A Postgres-backed queue with at-least-once delivery (claim via FOR UPDATE
-- SKIP LOCKED), time-based scheduling (run_at), retry with exponential backoff
-- (attempts/max_attempts/run_at), and a dead-letter terminal status. The worker
-- claims jobs as the owner role (bypassing RLS) and binds app.tenant_id per job
-- before invoking the handler (ADR 0027, DoD worker runtime requirements).
-- =============================================================================

CREATE TABLE worker_job (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id),
  job_kind      text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead_letter')),
  priority      integer     NOT NULL DEFAULT 0,
  run_at        timestamptz NOT NULL DEFAULT now(),
  attempts      integer     NOT NULL DEFAULT 0,
  max_attempts  integer     NOT NULL DEFAULT 5,
  last_error    text,
  locked_at     timestamptz,
  locked_by     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Claim path scans ready jobs by priority then schedule time.
CREATE INDEX worker_job_ready_idx
  ON worker_job (priority DESC, run_at ASC)
  WHERE status = 'pending';
CREATE INDEX worker_job_tenant_idx ON worker_job (tenant_id);
CREATE INDEX worker_job_dlq_idx ON worker_job (tenant_id, status) WHERE status = 'dead_letter';

ALTER TABLE worker_job ENABLE ROW LEVEL SECURITY;

-- App-side enqueue/read is tenant-scoped. The worker process claims as the
-- owner role, which bypasses RLS, then sets tenant context per job.
CREATE POLICY wj_tenant_isolation_select ON worker_job
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY wj_tenant_isolation_insert ON worker_job
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY wj_tenant_isolation_update ON worker_job
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
