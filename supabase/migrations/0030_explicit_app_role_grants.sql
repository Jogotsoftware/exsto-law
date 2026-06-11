-- =============================================================================
-- Migration 0030: explicit app-role grants (v1.0.2)
--
-- The foundation implicitly relied on Supabase's platform DEFAULT PRIVILEGES
-- to grant `authenticated` access to tables at creation time. A 2026-06 CLI/
-- image update removed those blanket defaults on FRESH stacks — caught by the
-- grants + RLS invariant tests in CI (yesterday's green commit fails on
-- today's image), and it would have broken the next fresh-project clone at
-- runtime the same way. The substrate's access posture must be explicit and
-- self-contained:
--
--   authenticated: USAGE on schema; SELECT+INSERT+UPDATE on tables (RLS scopes
--     rows; bitemporal/seal triggers constrain updates; append-only tables get
--     UPDATE/DELETE/TRUNCATE re-revoked below per 0017, with the 0021 lifecycle
--     exception for migration_job). No DELETE anywhere (corrections are rows).
--   anon: nothing (re-asserts the 0019/0023 lockdown).
--   future tables (incl. clone vertical tables on fresh projects): default
--     privileges set here so the posture survives platform changes.
--
-- Idempotent; no-op on instances that already carry these grants.
-- =============================================================================

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Re-assert the append-only posture (0017): no UPDATE/DELETE/TRUNCATE for app
-- roles; structural triggers remain the deeper enforcement.
DO $$
DECLARE
  t text;
  append_only text[] := ARRAY[
    'action', 'event', 'raw_event_log', 'access_log', 'reasoning_trace',
    'causal_claim', 'fact_contestation', 'identity_assertion',
    'configuration_change', 'schema_migration', 'migration_job',
    'approval_response', 'communication_message', 'substrate_capability_metric'
  ];
BEGIN
  FOREACH t IN ARRAY append_only LOOP
    EXECUTE format(
      'REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated, service_role',
      t
    );
  END LOOP;
END
$$;

-- Lifecycle exception (ADR 0039 / 0021): migration_job status mutates in place.
GRANT UPDATE ON public.migration_job TO authenticated, service_role;

-- anon stays fully locked (re-asserts 0019/0023 against any platform drift).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Future tables created by the migration role inherit the posture explicitly,
-- platform defaults or not. (0019's anon default-privilege revokes stand.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

SELECT public.sync_migration_history();
