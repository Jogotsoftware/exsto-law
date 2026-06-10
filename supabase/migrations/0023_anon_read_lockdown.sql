-- =============================================================================
-- Migration 0023: Invariant 1 — anon has ZERO access to substrate tables
-- 0019 stripped anon's write grants but left SELECT in place, relying on RLS +
-- "anon cannot set app.tenant_id" as the read defense. The adversarial audit
-- (docs/ADVERSARIAL_AUDIT.md, finding A1) showed that defense is GUC-dependent:
-- if app.tenant_id is ever set under the anon role (a misconfigured data API, or
-- the app connecting as anon), anon reads tenant rows.
--
-- The substrate is reached ONLY through the app/adapters as the non-owner
-- `authenticated` role (ADR 0037); the public `anon` Postgres role never reads
-- substrate tables directly. So we revoke ALL anon privileges on every public
-- table and pin default privileges, making the lockdown grant-enforced (belt) on
-- top of RLS (suspenders) rather than relying on a session variable.
--
-- Safe: no source path reads the substrate as the anon role (the browser uses the
-- anon key for auth only; reads go through the MCP/REST adapters as authenticated).
-- =============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Future tables/sequences created by the migration role must not grant anything
-- back to anon — keeps the lockdown reproducible in any cloned project.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

SELECT public.sync_migration_history();
