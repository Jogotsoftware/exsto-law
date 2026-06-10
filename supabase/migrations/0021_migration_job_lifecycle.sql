-- =============================================================================
-- Migration 0021: Reclassify migration_job as a LIFECYCLE table (Q#10 / ADR 0039)
-- A migration_job is a schema/data migration whose STATUS mutates over its life
-- (pending -> running -> completed/failed/reversed). worker_job (0013) is the
-- precedent: an operational record updated in place, tenant-scoped, whose history
-- is captured by the EVENTS its transitions emit — not by append-only row chains.
--
-- Migration 0017 had enrolled migration_job in append-only enforcement (honoring
-- the prior CLAUDE.md hard-rule-3 wording). ARCHITECTURE.md, however, describes
-- migration_job as having a "status lifecycle". ADR 0039 resolves that conflict in
-- favor of the lifecycle reading. This migration reverses the append-only
-- treatment for migration_job ONLY.
--
-- fact_contestation STAYS append-only — its resolutions are new linked records via
-- contestation_group_id/supersedes_id, never edits — so it is left untouched.
-- =============================================================================

-- 1. Drop the append-only trigger 0017 placed on migration_job (it raised on every
--    UPDATE/DELETE, for every role). Lifecycle rows must be updatable.
DROP TRIGGER IF EXISTS zzz_append_only ON public.migration_job;

-- 2. Swap the deny-UPDATE policy for a tenant-scoped UPDATE policy (status mutates
--    in place). DELETE stays denied (mj_no_delete remains) — there is no hard-delete
--    path; a cancelled/obsolete job ends in a terminal status, it is not removed.
DROP POLICY IF EXISTS mj_no_update ON public.migration_job;
CREATE POLICY mj_tenant_isolation_update ON public.migration_job
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 3. Restore the UPDATE grant 0017 revoked, to the app roles only. anon stays
--    write-free (0019); DELETE/TRUNCATE stay revoked (0019). Mirrors worker_job.
GRANT UPDATE ON public.migration_job TO authenticated, service_role;

-- 4. Drop the now-obsolete append-only supersession columns. They modeled status
--    transitions as new rows; lifecycle mutates status in place. The dependent
--    index migration_job_group_idx is dropped automatically with job_group_id.
--    (migration_job is empty; no data is affected.)
ALTER TABLE public.migration_job
  DROP COLUMN IF EXISTS supersedes_id,
  DROP COLUMN IF EXISTS job_group_id;

COMMENT ON TABLE public.migration_job IS
  'Schema/data migration as a first-class operation. LIFECYCLE table (ADR 0039): '
  'status mutates in place (pending->running->completed/failed/reversed); every '
  'transition must emit an event (the audit record), not a new append-only row. '
  'worker_job is the precedent.';

SELECT public.sync_migration_history();
