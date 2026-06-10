-- =============================================================================
-- Migration 0026: clone upgrade path infra (ADR 0043) + money helper (ADR 0044)
--
-- (1) private.vertical_migration — the ledger for the VERTICAL migration sequence.
--     The core sequence (this directory, supabase/migrations/) is tracked by the
--     Supabase CLI; the vertical sequence (supabase/migrations_vertical/, authored
--     by clones) is applied by scripts/migrate-vertical.mjs and recorded here. Two
--     disjoint namespaces with two ledgers, so a foundation upgrade's new core
--     migrations never collide with a clone's vertical migrations. Deployment infra
--     (not tenant data), so it lives in `private` — off the public tenant-RLS
--     surface, like the CLI's own ledger.
--
-- (2) public.money_to_numeric — precision-safe extraction of a monetary amount
--     stored as a decimal STRING in jsonb (ADR 0044). Raises if the field is a JSON
--     number (which would already have lost precision through IEEE-754).
-- =============================================================================

-- --- (1) vertical migration ledger ------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.vertical_migration (
  version    text        PRIMARY KEY,           -- e.g. '0001' in the vertical sequence
  name       text        NOT NULL,
  checksum   text,                              -- sha256 of the file at apply time
  applied_at timestamptz NOT NULL DEFAULT now()
);
-- No grants to anon/authenticated: only the migration role (owner) reads/writes it,
-- exactly like supabase_migrations.schema_migrations.
REVOKE ALL ON private.vertical_migration FROM PUBLIC, anon, authenticated;

-- --- (2) money helper (ADR 0044) --------------------------------------------
-- Amounts are decimal strings in jsonb; math casts to numeric. This both extracts
-- and guards: a JSON-number amount is a precision bug, surfaced as a loud error.
CREATE OR REPLACE FUNCTION public.money_to_numeric(value jsonb, key text DEFAULT 'amount')
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  el jsonb;
BEGIN
  el := value -> key;
  IF el IS NULL THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(el) = 'number' THEN
    RAISE EXCEPTION
      'money_to_numeric: field "%" is a JSON number (precision-unsafe); store amounts as decimal strings (ADR 0044)', key;
  END IF;
  RETURN (value ->> key)::numeric;
END
$$;

REVOKE ALL ON FUNCTION public.money_to_numeric(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.money_to_numeric(jsonb, text) TO authenticated;

SELECT public.sync_migration_history();
