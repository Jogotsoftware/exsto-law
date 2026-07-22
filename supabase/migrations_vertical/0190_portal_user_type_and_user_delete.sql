-- =============================================================================
-- Vertical migration 0190: Users & Roles split — portal user type +
-- firm-user delete + portal-access restore
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR.
--
-- Three concerns, one settings surface (the two-tab Users & Roles page):
--   • portal_user_type attribute on client_contact — 'standard' (no AI
--     assistant) or 'self_serve' (full access). ABSENT means 'self_serve' so
--     every live portal account keeps its current behavior with zero backfill;
--     an attorney downgrades a user explicitly.
--   • legal.user.delete — remove a firm user from the Users & Roles list. No
--     hard delete exists for actors (append-only substrate; actor.status CHECK
--     allows only active/inactive), so delete = the deactivate mechanics plus a
--     user.deleted event marker that the list read excludes. Re-inviting the
--     same email restores the row (legal.user.invite already reactivates).
--   • legal.client.restore_portal_access — the inverse 0184 never had: flip a
--     revoked portal actor back to active. Needed because the new login-only
--     portal delete keeps the client_contact active (Joe 2026-07-21: "login
--     only, keep CRM contact"), so re-invite must be able to reopen the door
--     the revoke closed. provision_portal_actor deliberately does NOT
--     reactivate (idempotency returns the mapping as-is) or any sign-in
--     would silently undo a revoke.
--
-- Ids: fresh …3300 sub-block in the 1011 (attribute_kind) / 1013 (action_kind)
-- / 1014 (event_kind) bands — 0184 took …3000, 0188 took …3100, the parallel 0189 took …3200; verified free
-- against every migrations_vertical file on main at authoring time.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kind (tenant-zero, fixed id) ───────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000003300', '00000000-0000-0000-0000-000000000001',
       'portal_user_type', 'Portal user type',
       'How much of the portal this client contact may use: ''standard'' (everything except the AI assistant) or ''self_serve'' (full access). ABSENT means self_serve — the pre-existing behavior — so deploying the gate never strips a live account. Set via legal.client.set_portal_user_type from the Users & Roles page.',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'client_contact' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

-- ── event kinds (tenant-zero, fixed ids) ─────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000003300', '00000000-0000-0000-0000-000000000001',
   'user.deleted', 'Firm user deleted',
   'A firm user was removed from the Users & Roles list by an admin. The actor row remains (provenance is forever) with status inactive; this marker is what hides the row from legal.user.list. Payload: actor_id, email, display_name. No primary entity — actors are identity rows, not entities.',
   false),
  ('00000000-0000-0000-1014-000000003301', '00000000-0000-0000-0000-000000000001',
   'portal.access_restored', 'Portal access restored',
   'A previously revoked portal actor was reactivated (re-invite after a login-only portal delete). Payload: client_contact_id, actor_id. Primary = the client_contact.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── action kinds (tenant-zero, fixed ids) ────────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000003300', '00000000-0000-0000-0000-000000000001',
   'legal.client.set_portal_user_type', 'Set portal user type',
   'Set a client contact''s portal tier: ''standard'' (no AI assistant) or ''self_serve'' (full access). Writes the portal_user_type attribute on the client_contact with the acting attorney as source. Enforced server-side at the assistant stream route and reflected in the portal home payload.',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000003301', '00000000-0000-0000-0000-000000000001',
   'legal.user.delete', 'Delete firm user',
   'Remove a firm user from the Users & Roles list: deactivate the actor, close their scope assignments, and emit user.deleted (the list read excludes marked rows). Admin only; caller must strictly out-rank the target; never self. Re-inviting the same email reactivates the account.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000003302', '00000000-0000-0000-0000-000000000001',
   'legal.client.restore_portal_access', 'Restore client portal access',
   'Reactivate the portal actor a prior legal.client.revoke_portal_access deactivated (the login-only portal delete keeps the client_contact active, so this is the re-invite''s way back in). No-ops when no mapping exists or the actor is already active. Emits portal.access_restored when it flips.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant (0188 idiom) ──────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), ekd.tenant_id, 'portal_user_type', 'Portal user type',
       'How much of the portal this client contact may use: ''standard'' (everything except the AI assistant) or ''self_serve'' (full access). Absent means self_serve.',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.kind_name = 'client_contact' AND ekd.status = 'active'
  AND ekd.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = ekd.tenant_id AND a.kind_name = 'portal_user_type'
  );

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT gen_random_uuid(), t.tenant_id, v.kind_name, v.display_name, v.description, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'client_contact' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
CROSS JOIN (VALUES
  ('user.deleted', 'Firm user deleted',
   'A firm user was removed from the Users & Roles list by an admin. Payload: actor_id, email, display_name.'),
  ('portal.access_restored', 'Portal access restored',
   'A previously revoked portal actor was reactivated. Payload: client_contact_id, actor_id. Primary = the client_contact.')
) AS v(kind_name, display_name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM event_kind_definition e
  WHERE e.tenant_id = t.tenant_id AND e.kind_name = v.kind_name
);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, v.kind_name, v.display_name, v.description,
       'notify', v.reversibility, NULL, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'client_contact' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
CROSS JOIN (VALUES
  ('legal.client.set_portal_user_type', 'Set portal user type',
   'Set a client contact''s portal tier: ''standard'' (no AI assistant) or ''self_serve'' (full access).',
   'fully_reversible'),
  ('legal.user.delete', 'Delete firm user',
   'Remove a firm user from the Users & Roles list: deactivate, close scopes, emit user.deleted. Re-invite restores.',
   'reversible_with_state_decay'),
  ('legal.client.restore_portal_access', 'Restore client portal access',
   'Reactivate the portal actor a prior revoke deactivated. No-ops when already active or never provisioned.',
   'fully_reversible')
) AS v(kind_name, display_name, description, reversibility)
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = v.kind_name
);

SELECT public.sync_migration_history();
