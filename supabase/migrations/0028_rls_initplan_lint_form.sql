-- =============================================================================
-- Migration 0028: RLS initplan — lint-recognized wrapping form (v1.0.1)
--
-- 0027 wrapped the per-row GUC call in a scalar subquery with the cast INSIDE:
--     ( SELECT (current_setting('app.tenant_id', true))::uuid )
-- The InitPlan optimization is real, but Postgres deparses that as
-- "SELECT (current_setting…", and the Supabase `auth_rls_initplan` lint
-- requires SELECT-adjacent `current_setting` to recognize the remediation —
-- so all 167 WARNs kept firing. This migration moves the cast OUTSIDE:
--     ((SELECT current_setting('app.tenant_id', true)))::uuid
-- Same value, same InitPlan, lint-clean (verified empirically on the
-- reference instance: one policy rewritten → WARN count 167 → 166).
--
-- Handles both 0027's wrapped form and any still-bare straggler. Replace order
-- matters: the bare expression is a SUBSTRING of 0027's wrapped form, so the
-- wrapped form is rewritten first. Forward-only; idempotent.
-- =============================================================================

DO $$
DECLARE
  p RECORD;
  wrapped027 CONSTANT text := '( SELECT (current_setting(''app.tenant_id''::text, true))::uuid AS current_setting)';
  bare CONSTANT text := '(current_setting(''app.tenant_id''::text, true))::uuid';
  final CONSTANT text := '((SELECT current_setting(''app.tenant_id''::text, true)))::uuid';
  new_qual text;
  new_check text;
  altered int := 0;
BEGIN
  FOR p IN
    SELECT policyname, tablename, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        coalesce(qual, '') LIKE '%' || wrapped027 || '%'
        OR coalesce(with_check, '') LIKE '%' || wrapped027 || '%'
        OR (coalesce(qual, '') LIKE '%' || bare || '%' AND coalesce(qual, '') NOT LIKE '%SELECT%')
        OR (coalesce(with_check, '') LIKE '%' || bare || '%' AND coalesce(with_check, '') NOT LIKE '%SELECT%')
      )
  LOOP
    new_qual := NULL;
    new_check := NULL;

    IF p.qual IS NOT NULL THEN
      new_qual := replace(p.qual, wrapped027, final);
      IF new_qual NOT LIKE '%SELECT%' THEN
        new_qual := replace(new_qual, bare, final);
      END IF;
      IF new_qual = p.qual THEN
        new_qual := NULL;
      END IF;
    END IF;

    IF p.with_check IS NOT NULL THEN
      new_check := replace(p.with_check, wrapped027, final);
      IF new_check NOT LIKE '%SELECT%' THEN
        new_check := replace(new_check, bare, final);
      END IF;
      IF new_check = p.with_check THEN
        new_check := NULL;
      END IF;
    END IF;

    IF new_qual IS NOT NULL OR new_check IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I%s%s',
        p.policyname,
        p.tablename,
        CASE WHEN new_qual IS NOT NULL THEN format(' USING (%s)', new_qual) ELSE '' END,
        CASE WHEN new_check IS NOT NULL THEN format(' WITH CHECK (%s)', new_check) ELSE '' END
      );
      altered := altered + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'rls initplan lint-form rewrite: % policies updated', altered;
END
$$;

SELECT public.sync_migration_history();
