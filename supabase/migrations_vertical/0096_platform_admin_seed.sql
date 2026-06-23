-- =============================================================================
-- Vertical migration 0096: seed the first platform admin (ADR 0046)
--
-- The platform tenant + its system actor ship in 0095. This seeds the founder as
-- the first human platform admin so the admin console is reachable on day one.
-- Authority is the platform_admin row (is_platform_admin checks it); admin sign-in
-- resolves the Google email -> this actor via private.cp_resolve_admin_by_email.
--
-- Safe to use the founder's REAL email as external_id here: lookupActorByEmail
-- (firm sign-in, identity.ts) now excludes the platform/sandbox tenants, so this
-- actor can never hijack the founder's FIRM sign-in. Additional admins are added
-- by inserting platform_admin rows (a later seed migration or an admin tool);
-- revocation sets revoked_at.
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING. Number 0096 = next after 0095.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-00FF-000000000001', false);

-- The founder's platform human actor (sign-in identity: joe@revenueinstruments.com).
INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status) VALUES
  ('00000000-0000-0000-00FF-00000000000a', '00000000-0000-0000-00FF-000000000001',
   'human', 'joe@revenueinstruments.com', 'Joe Pacheco', 'active')
ON CONFLICT (id) DO NOTHING;

-- The platform_admin record (the authority is_platform_admin / resolve check).
INSERT INTO platform_admin (id, tenant_id, actor_id, email, granted_by_actor_id) VALUES
  ('00000000-0000-0000-00FF-00000000000b', '00000000-0000-0000-00FF-000000000001',
   '00000000-0000-0000-00FF-00000000000a', 'joe@revenueinstruments.com',
   '00000000-0000-0000-00FF-000000000002')
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
