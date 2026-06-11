-- =============================================================================
-- Migration 0027: RLS initplan optimization (v1.0.1 FIX 2)
--
-- Postgres re-evaluates bare current_setting() calls in RLS policies PER ROW.
-- Wrapping the call in a scalar subquery makes the planner evaluate it once
-- per query (an InitPlan) — the standard remediation for the Supabase
-- `auth_rls_initplan` performance advisor (167 WARNs on the reference
-- instance; surfaced operationally by the exsto-law Phase 0 build).
--
-- PURE performance change: the wrapped expression returns the identical value,
-- so policy semantics are unchanged. The rewrite is programmatic over
-- pg_policies so it also covers any policies a CLONE has authored with the
-- same pattern (vertical tables get the optimization for free on upgrade).
-- Deny-policies (`false`) and already-wrapped policies are untouched.
-- Forward-only; idempotent (a second run finds nothing to rewrite).
-- =============================================================================

DO $$
DECLARE
  p RECORD;
  bare CONSTANT text := '(current_setting(''app.tenant_id''::text, true))::uuid';
  wrapped CONSTANT text := '( SELECT (current_setting(''app.tenant_id''::text, true))::uuid )';
  new_qual text;
  new_check text;
  altered int := 0;
BEGIN
  FOR p IN
    SELECT policyname, tablename, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (qual IS NOT NULL AND qual LIKE '%' || bare || '%' AND qual NOT LIKE '%SELECT (current_setting%')
        OR
        (with_check IS NOT NULL AND with_check LIKE '%' || bare || '%' AND with_check NOT LIKE '%SELECT (current_setting%')
      )
  LOOP
    new_qual := NULL;
    new_check := NULL;
    IF p.qual IS NOT NULL AND p.qual LIKE '%' || bare || '%' AND p.qual NOT LIKE '%SELECT (current_setting%' THEN
      new_qual := replace(p.qual, bare, wrapped);
    END IF;
    IF p.with_check IS NOT NULL AND p.with_check LIKE '%' || bare || '%' AND p.with_check NOT LIKE '%SELECT (current_setting%' THEN
      new_check := replace(p.with_check, bare, wrapped);
    END IF;

    EXECUTE format(
      'ALTER POLICY %I ON public.%I%s%s',
      p.policyname,
      p.tablename,
      CASE WHEN new_qual IS NOT NULL THEN format(' USING (%s)', new_qual) ELSE '' END,
      CASE WHEN new_check IS NOT NULL THEN format(' WITH CHECK (%s)', new_check) ELSE '' END
    );
    altered := altered + 1;
  END LOOP;

  RAISE NOTICE 'rls initplan optimization: % policies rewritten', altered;
END
$$;

SELECT public.sync_migration_history();
