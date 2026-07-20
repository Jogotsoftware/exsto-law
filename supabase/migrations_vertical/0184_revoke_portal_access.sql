-- =============================================================================
-- Vertical migration 0184 (renumbered from 0183; 0183 = document_redlined on main): legal.client.revoke_portal_access action +
-- portal.access_revoked event (A2.3)
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR.
--
-- The inverse of legal.client.provision_portal_actor (0135): an attorney can
-- remove a client's portal access (deactivate their mapped actor + archive the
-- client_contact — see verticals/legal/src/api/portalAccess.ts for why both
-- writes are needed). No existing action does this; nothing was ever flipping
-- client_contact.status off 'active', which is what isClientContactActive and
-- findClientContactMembershipsByEmail (clientIdentity.ts) both gate on — the
-- root cause of "I deactivated them but they can still log in."
--
-- Marked irreversible: no reverse action exists in this codebase today (a
-- re-invite sends a new set-password email, but sign-in stays refused while
-- the contact is archived — see the tool description in contactTools.ts).
-- Building a restore path is a natural follow-up, not in this PR's scope.
--
-- Ids: fresh …3000 sub-block in the 1013 (action_kind) / 1014 (event_kind)
-- bands — verified free against every migrations_vertical file up to and
-- including 0182 (this branch's own A1 migration, unmerged).
--
-- Multi-tenant: same 0178 idiom — tenant-zero gets the fixed id below; every
-- OTHER tenant that already has the client_contact entity kind gets the
-- catch-up loop (gen_random_uuid, idempotent by EXISTS check, not by fixed
-- id). ON CONFLICT DO NOTHING on the fixed-id inserts.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── action kind (tenant-zero, fixed id) ──────────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000003000', '00000000-0000-0000-0000-000000000001',
   'legal.client.revoke_portal_access', 'Revoke client portal access',
   'Deactivate the actor a client_contact acts as in the portal (status -> inactive) so their current session/next sign-in is refused. Payload: client_contact_id. Emits portal.access_revoked. Callers additionally archive the client_contact via the core entity.archive action — that is what actually stops clientSessionMint from lazily re-provisioning a fresh actor on the contact''s next sign-in attempt.',
   'notify', 'irreversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── event kind (tenant-zero, fixed id) ───────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000003000', '00000000-0000-0000-0000-000000000001',
   'portal.access_revoked', 'Portal access revoked',
   'A client contact''s portal access was removed by an attorney. Payload: client_contact_id, actor_id (nullable — null when the client never signed in/was provisioned), actor_deactivated. Primary = the client_contact.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: both kinds for every OTHER tenant that already has the
-- client_contact entity kind (Pacheco and any future non-dev tenant). Skips
-- tenant-zero (already covered above) and any tenant that somehow already has
-- the kind (re-run safe).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'client_contact' AND status = 'active'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    IF NOT EXISTS (
      SELECT 1 FROM action_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'legal.client.revoke_portal_access'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO action_kind_definition
        (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'legal.client.revoke_portal_access', 'Revoke client portal access',
         'Deactivate the actor a client_contact acts as in the portal (status -> inactive) so their current session/next sign-in is refused. Payload: client_contact_id. Emits portal.access_revoked. Callers additionally archive the client_contact via the core entity.archive action — that is what actually stops clientSessionMint from lazily re-provisioning a fresh actor on the contact''s next sign-in attempt.',
         'notify', 'irreversible', NULL, false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM event_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'portal.access_revoked'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO event_kind_definition
        (id, tenant_id, kind_name, display_name, description, is_state_change)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'portal.access_revoked', 'Portal access revoked',
         'A client contact''s portal access was removed by an attorney. Payload: client_contact_id, actor_id (nullable — null when the client never signed in/was provisioned), actor_deactivated. Primary = the client_contact.',
         false);
    END IF;
  END LOOP;
END $$;

SELECT public.sync_migration_history();
