-- =============================================================================
-- Migration 0017: Invariant 14 — enforce append-only at the DB layer
-- RLS deny policies are NOT enough: service_role and postgres have BYPASSRLS, so
-- they could UPDATE/DELETE append-only rows. Defense in depth:
--   (a) REVOKE UPDATE/DELETE/TRUNCATE from anon, authenticated, service_role
--   (b) a BEFORE UPDATE OR DELETE trigger that RAISES — fires for EVERY role,
--       including the table owner and BYPASSRLS roles.
-- Applies to the strictly append-only tables (CLAUDE.md hard rule 3).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.substrate_block_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only violation: % on public.% is not permitted (invariant 14)',
    TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

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
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('DROP TRIGGER IF EXISTS zzz_append_only ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER zzz_append_only BEFORE UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.substrate_block_write()', t);
  END LOOP;
END $$;

SELECT public.sync_migration_history();
