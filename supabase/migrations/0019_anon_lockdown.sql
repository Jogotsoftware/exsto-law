-- =============================================================================
-- Migration 0019: Invariant 14/1 — anon has zero write/delete; no hard deletes
-- Strip every write/delete grant from anon on all public substrate tables, and
-- remove DELETE/TRUNCATE from authenticated and service_role everywhere (the
-- substrate has no hard-delete path — corrections are new rows / valid_to close).
-- Default privileges are adjusted so tables added later never re-grant writes to
-- anon, keeping this reproducible in any cloned project.
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated, service_role;

-- Future tables created by the migration role must not grant writes to anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE DELETE, TRUNCATE ON TABLES FROM authenticated, service_role;

SELECT public.sync_migration_history();
