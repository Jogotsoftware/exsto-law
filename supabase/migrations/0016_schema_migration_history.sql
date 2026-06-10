-- =============================================================================
-- Migration 0016: Invariant 12 — migration history as queryable data
-- supabase_migrations.schema_migrations is the platform's private ledger.
-- The substrate also records every applied migration in public.schema_migration
-- so history is queryable as first-class data (schema-as-data). The table
-- already exists for kind-change records; extend it to also hold migration
-- records (entry_kind discriminator), and provide a reproducible sync from the
-- platform ledger that any cloned project can run.
-- =============================================================================

ALTER TABLE public.schema_migration
  ALTER COLUMN tenant_id        DROP NOT NULL,
  ALTER COLUMN action_id        DROP NOT NULL,
  ALTER COLUMN change_kind      DROP NOT NULL,
  ALTER COLUMN target_kind      DROP NOT NULL,
  ALTER COLUMN target_kind_name DROP NOT NULL,
  ADD COLUMN entry_kind text NOT NULL DEFAULT 'kind_change'
    CHECK (entry_kind IN ('kind_change', 'migration')),
  ADD COLUMN version    text,
  ADD COLUMN name       text,
  ADD COLUMN checksum   text,
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN applied_by text;

-- Migration records are global (not tenant-scoped) and one row per version.
CREATE UNIQUE INDEX schema_migration_version_uq
  ON public.schema_migration (version) WHERE entry_kind = 'migration';

-- Migration history is non-sensitive and readable regardless of tenant context.
CREATE POLICY sm_global_migration_select ON public.schema_migration
  FOR SELECT USING (entry_kind = 'migration');

-- Reproducible backfill/sync from the platform ledger. Idempotent: only inserts
-- versions not already recorded. checksum = md5 of the applied statements.
CREATE OR REPLACE FUNCTION public.sync_migration_history() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE inserted integer;
BEGIN
  INSERT INTO public.schema_migration (entry_kind, version, name, checksum, applied_at, applied_by)
  SELECT 'migration', m.version, m.name,
         md5(coalesce(array_to_string(m.statements, ';'), '')),
         CASE WHEN m.version ~ '^[0-9]{14}$'
              THEN to_timestamp(m.version, 'YYYYMMDDHH24MISS')
              ELSE now() END,
         -- `current_user`, NOT m.created_by: the local Supabase CLI's
         -- supabase_migrations.schema_migrations has no created_by column (it
         -- exists only on hosted projects). Referencing it aborted fresh-clone
         -- migration at 0016 under `supabase start` (column does not exist).
         -- current_user is portable across the CLI and hosted, and sufficient.
         current_user
  FROM supabase_migrations.schema_migrations m
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schema_migration s
     WHERE s.entry_kind = 'migration' AND s.version = m.version
  );
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;

COMMENT ON FUNCTION public.sync_migration_history() IS
  'Records every applied migration into public.schema_migration (invariant 12). Call at the end of each migration and after deploy; self-healing and idempotent.';

-- Backfill the migrations applied so far.
SELECT public.sync_migration_history();
