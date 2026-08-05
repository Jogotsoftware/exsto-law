-- =============================================================================
-- Vertical migration 0199: worker tenant enumeration for multi-firm reconcile.
--
-- SECOND-FIRM-1. The worker's startup bootstraps (meeting/draft/capability
-- reconcile) were seeded for tenant zero only — fine with one real firm, wrong
-- the moment firm #2 exists (its calendar would never reconcile and its
-- orphaned jobs would never surface). private.worker_list_active_tenants()
-- gives the worker (and any future infra consumer) the ONE agreed answer to
-- "which tenants does per-tenant background work run for": every ACTIVE tenant
-- EXCEPT the platform/sandbox infrastructure tenants (the same reserved ids
-- verticals/legal/src/controlPlane/context.ts names PLATFORM_TENANT_ID /
-- SANDBOX_TENANT_ID). The exclusion lives HERE, in SQL, so every consumer
-- agrees — no caller-side reserved-id lists to drift.
--
-- SECURITY DEFINER because the worker enumerates tenants BEFORE it has any
-- tenant context to bind (the same reason resolve_public_firm is a definer
-- function); it exposes only tenant ids, no tenant data. Same grant posture as
-- 0197: REVOKE from PUBLIC and anon. Functions only, no new kinds. 0199 is
-- above main+prod max (0198). Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.worker_list_active_tenants()
RETURNS TABLE (id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id
  FROM public.tenant t
  WHERE t.status = 'active'
    -- Infrastructure tenants (controlPlane/context.ts PLATFORM_TENANT_ID /
    -- SANDBOX_TENANT_ID): never ordinary firm targets, never reconciled.
    AND t.id NOT IN (
      '00000000-0000-0000-00FF-000000000001'::uuid,  -- platform control plane
      '00000000-0000-0000-00FE-000000000001'::uuid   -- sandbox
    )
  ORDER BY t.created_at
$$;

REVOKE ALL ON FUNCTION private.worker_list_active_tenants() FROM PUBLIC, anon;
