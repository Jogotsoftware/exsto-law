-- =============================================================================
-- Migration 0025: durable idempotency store for the REST adapter (Task 3a)
-- The REST adapter de-duplicates writes carrying an `Idempotency-Key` header. The
-- prior store was an in-memory Map — per-process and lost on restart, so a retry
-- hitting another instance (or after a redeploy) re-submitted the action. This
-- table makes idempotency durable and shared across instances, tenant-scoped by
-- RLS.
--
-- A lifecycle/infra table (like worker_job / api_key, ADR 0039): status mutates in
-- place (in_progress -> completed), history is the action stream it guards, and it
-- has NO hard-delete path — expiry is handled by reclaiming rows whose expires_at
-- has passed. request_fingerprint lets the adapter reject a key replayed with a
-- different request body (a client bug or abuse) instead of returning the wrong
-- cached response.
-- =============================================================================

CREATE TABLE idempotency_key (
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  idempotency_key     text        NOT NULL,
  request_fingerprint text        NOT NULL,
  status              text        NOT NULL DEFAULT 'in_progress'
                                  CHECK (status IN ('in_progress', 'completed')),
  response_status     int,
  response_body       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (tenant_id, idempotency_key)
);

ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;

-- Sensitive infra: no anon access at all (0023 also covers this for new tables).
REVOKE ALL ON idempotency_key FROM anon;

CREATE POLICY ik_tenant_isolation_select ON idempotency_key
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ik_tenant_isolation_insert ON idempotency_key
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ik_tenant_isolation_update ON idempotency_key
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- No DELETE policy and no DELETE grant: expired rows are reclaimed in place, never
-- hard-deleted (ADR 0039). An optional janitor could prune via a privileged path.

SELECT public.sync_migration_history();
