-- =============================================================================
-- Migration 0075: user-management action kinds (S9 — WP9.3)
--
-- The substrate had no way to create/retire an actor or (re)bind its scopes
-- through the action layer — only `actor_scope.assign` existed. The legal
-- vertical's user-management UI needs three more write verbs, added the
-- schema-as-data way (definition rows, never hardcoded enums — hard rule 8):
--
--   legal.user.invite       create (or re-activate) a human actor + assign a role
--   legal.user.assign_role  re-bind an actor's permission scopes to a role
--   legal.user.deactivate   set actor.status='inactive' + close its scopes
--
-- Handlers live in verticals/legal (registered through registerActionHandler);
-- they run on the action's transaction, so every write still flows through
-- submitAction (hard rule 1). Seeded for BOTH tenants so the tools work in
-- either firm. action_kind_definition carries no action_id, so these are plain
-- inserts. Idempotent: fixed UUIDs + ON CONFLICT (id) DO NOTHING.
-- =============================================================================

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
VALUES
  -- Tenant zero (Pacheco Law)
  ('00000000-0000-0000-0075-000000000001', '00000000-0000-0000-0000-000000000001',
   'legal.user.invite', 'Invite firm user', 'Create or re-activate a human actor and assign a role.',
   'notify', 'reversible_with_state_decay', 'legal.user.deactivate', false),
  ('00000000-0000-0000-0075-000000000002', '00000000-0000-0000-0000-000000000001',
   'legal.user.assign_role', 'Assign firm role', 'Re-bind a firm user''s permission scopes to a role.',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-0075-000000000003', '00000000-0000-0000-0000-000000000001',
   'legal.user.deactivate', 'Deactivate firm user', 'Deactivate a firm user and close their permission scopes.',
   'notify', 'reversible_with_state_decay', 'legal.user.invite', false),
  -- Tenant B (Liberty Legal)
  ('00000000-0000-0000-0075-000000000011', '00000000-0000-0000-0000-000000000002',
   'legal.user.invite', 'Invite firm user', 'Create or re-activate a human actor and assign a role.',
   'notify', 'reversible_with_state_decay', 'legal.user.deactivate', false),
  ('00000000-0000-0000-0075-000000000012', '00000000-0000-0000-0000-000000000002',
   'legal.user.assign_role', 'Assign firm role', 'Re-bind a firm user''s permission scopes to a role.',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-0075-000000000013', '00000000-0000-0000-0000-000000000002',
   'legal.user.deactivate', 'Deactivate firm user', 'Deactivate a firm user and close their permission scopes.',
   'notify', 'reversible_with_state_decay', 'legal.user.invite', false)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
