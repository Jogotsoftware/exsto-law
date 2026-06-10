-- =============================================================================
-- Migration 0024: least-privilege API-key auth path (ADR 0037, Task 3b)
-- The REST adapter must resolve a presented key to its (tenant, actor) BEFORE it
-- knows the tenant — an inherently cross-tenant read. Migration 0022 left that to
-- a privileged owner connection (`withSuperuser`). That works but means the auth
-- path holds owner/BYPASSRLS rights, which a least-privilege production deployment
-- should not require.
--
-- Fix: SECURITY DEFINER resolvers the app calls as the non-owner `authenticated`
-- role. The functions run with the definer's rights (so they can read api_key
-- across tenants by hash), return only the principal, and never expose the table.
-- The app connection never needs owner access for auth.
--
-- They live in a dedicated `private` schema, NOT `public`: PostgREST only exposes
-- public/graphql_public, so these are NOT reachable via the data API
-- (`/rest/v1/rpc/...`) — clearing advisor 0029 (SECURITY DEFINER callable by
-- signed-in users). The app calls them directly over its Postgres connection
-- (`private.auth_resolve_api_key(...)`), which is schema-independent.
-- `search_path=''` + fully-qualified names keep them advisor-clean (0020).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Resolve a presented key hash to its principal. Cross-tenant by design; returns
-- at most one row (key_hash is UNIQUE). Only non-revoked keys resolve.
CREATE OR REPLACE FUNCTION private.auth_resolve_api_key(p_key_hash text)
RETURNS TABLE (tenant_id uuid, actor_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT k.tenant_id, k.actor_id
  FROM public.api_key k
  WHERE k.key_hash = p_key_hash
    AND k.revoked_at IS NULL
$$;

-- Stamp last_used_at for a resolved key (best-effort usage telemetry).
CREATE OR REPLACE FUNCTION private.touch_api_key(p_key_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.api_key SET last_used_at = now() WHERE key_hash = p_key_hash
$$;

REVOKE ALL ON FUNCTION private.auth_resolve_api_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.touch_api_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.auth_resolve_api_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.touch_api_key(text) TO authenticated;

SELECT public.sync_migration_history();
