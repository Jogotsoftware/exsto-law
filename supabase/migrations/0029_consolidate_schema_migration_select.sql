-- =============================================================================
-- Migration 0029: consolidate schema_migration SELECT policies (v1.0.2)
--
-- schema_migration carried TWO permissive SELECT policies (global migration
-- rows + tenant-scoped rows). Multiple permissive policies for the same
-- role/action are OR'd anyway, but Postgres evaluates every one per query —
-- the source of all 5 remaining `multiple_permissive_policies` advisor WARNs
-- on the reference instance. One policy with the explicit OR has IDENTICAL
-- visibility semantics. The tenant arm keeps the lint-recognized InitPlan
-- form from 0028. Idempotent; forward-only.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='schema_migration' AND policyname='sm_global_migration_select') THEN
    DROP POLICY sm_global_migration_select ON public.schema_migration;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='schema_migration' AND policyname='sm_tenant_isolation_select') THEN
    DROP POLICY sm_tenant_isolation_select ON public.schema_migration;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='schema_migration' AND policyname='sm_select') THEN
    CREATE POLICY sm_select ON public.schema_migration FOR SELECT
      USING (
        entry_kind = 'migration'
        OR tenant_id = ((SELECT current_setting('app.tenant_id'::text, true)))::uuid
      );
  END IF;
END
$$;

SELECT public.sync_migration_history();
