-- =============================================================================
-- Migration 0022: API keys for the REST adapter
-- The REST/OpenAPI adapter (ADR 0038) authenticates callers with API keys and
-- derives the tenant + actor from the key server-side — never from the request.
-- This table holds the keys (hash only; the raw key is shown once at creation).
--
-- An infra/lifecycle table (like worker_job): RLS-scoped so a tenant manages only
-- its own keys, with last_used_at / revoked_at mutated in place. The REST auth
-- path resolves a presented key by its hash via a privileged narrow lookup
-- (cross-tenant), then binds the resolved tenant for the actual operation; that
-- lookup is auth infrastructure, not an operation handler.
-- =============================================================================

CREATE TABLE api_key (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenant(id),
  actor_id     uuid        NOT NULL REFERENCES actor(id),
  name         text        NOT NULL,
  key_prefix   text        NOT NULL,            -- non-secret display prefix, e.g. 'exsto_a1b2c3'
  key_hash     text        NOT NULL UNIQUE,     -- sha256 hex of the full raw key
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX api_key_tenant_idx ON api_key (tenant_id);
-- The UNIQUE key_hash provides the auth lookup index.

ALTER TABLE api_key ENABLE ROW LEVEL SECURITY;

-- Sensitive: no anon access at all (the auth lookup runs privileged, not as anon).
REVOKE ALL ON api_key FROM anon;

CREATE POLICY ak_tenant_isolation_select ON api_key
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ak_tenant_isolation_insert ON api_key
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ak_tenant_isolation_update ON api_key
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- No DELETE policy: keys are revoked (revoked_at), not deleted.

SELECT public.sync_migration_history();
