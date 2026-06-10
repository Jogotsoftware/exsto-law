-- =============================================================================
-- Migration 0018: Invariant 14/2 — protect bitemporally versioned fact tables
-- These tables are corrected by CLOSING a record (set valid_to) and appending a
-- new one, never by hard delete or by editing sealed history. Enforce:
--   (a) no hard DELETE (trigger raises; firing for every role incl. BYPASSRLS)
--   (b) sealed rows (valid_to IS NOT NULL) are immutable
--   (c) the only permitted UPDATE is the valid_to "close" of an open row
--       (no other column may change)
-- REVOKE DELETE/TRUNCATE from app roles; UPDATE stays (for the close) but is
-- trigger-guarded.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.substrate_block_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'no hard delete: DELETE on public.% is not permitted; close via valid_to (invariant 14)',
    TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

CREATE OR REPLACE FUNCTION public.substrate_seal_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.valid_to IS NOT NULL THEN
    RAISE EXCEPTION 'sealed row immutable: public.% closed at % cannot be modified (invariant 14)',
      TG_TABLE_NAME, OLD.valid_to USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'valid_to') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to') THEN
    RAISE EXCEPTION 'bitemporal close only: only valid_to may change on public.% (invariant 14)',
      TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  t text;
  bitemporal text[] := ARRAY[
    'attribute', 'relationship', 'judgment', 'outcome',
    'stakeholder_position', 'ownership_assignment',
    'hierarchy_membership', 'actor_scope_assignment'
  ];
BEGIN
  FOREACH t IN ARRAY bitemporal LOOP
    EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('DROP TRIGGER IF EXISTS zzz_no_delete ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER zzz_no_delete BEFORE DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.substrate_block_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS zzz_seal_guard ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER zzz_seal_guard BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.substrate_seal_guard()', t);
  END LOOP;
END $$;

SELECT public.sync_migration_history();
