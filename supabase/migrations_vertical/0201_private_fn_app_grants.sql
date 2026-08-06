-- =============================================================================
-- Vertical migration 0201: EXECUTE grants for the app role on private functions.
--
-- HOTFIX RECORD. 0198/0197/0199 copied 0101's REVOKE-only posture, but the
-- runtime app role is `authenticated` and default EXECUTE was revoked from
-- PUBLIC — so the FIRST live handoff exchange (AUTH-HANDOFF-1 pilot) failed
-- 42501 inside private.burn_handoff_jti and Google sign-in 500'd on the firm
-- host. The functions self-guard (single-use burn semantics; is_platform_admin
-- inside the cp_* bodies), so granting EXECUTE to authenticated is the intended
-- posture — matching cp_bootstrap_tenant/is_platform_admin, which already carry
-- it. Applied to prod out-of-band 2026-08-05 to unblock the pilot; this
-- migration re-runs the same idempotent grants so every environment converges.
-- 0201 is above main+prod max (0200). Idempotent.
-- =============================================================================

GRANT EXECUTE ON FUNCTION private.burn_handoff_jti(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_set_tenant_slug(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_list_tenants(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_get_tenant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.worker_list_active_tenants() TO authenticated;
