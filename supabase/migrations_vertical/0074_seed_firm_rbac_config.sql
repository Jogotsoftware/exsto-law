-- =============================================================================
-- Migration 0074: Seed the firm's RBAC config for tenant zero (S9 — WP9.2/9.3)
--
-- Bootstrap-style seed (the same way the tenant, actors and kind registries are
-- seeded directly): the firm's initial permission scopes and roles, plus the
-- owning attorney's admin grant. Everything references a single, clearly-labeled
-- bootstrap action so provenance is explicit (action_id is NOT NULL on these
-- governance tables). At RUNTIME these same rows are produced through the action
-- layer by the role.define / permission_scope.define / actor_scope.assign
-- primitives and the legal.user.* tools (WP9.3) — this migration only bootstraps
-- the starting set so a fresh clone comes up with roles defined and the owner
-- already admin.
--
-- Scope model (enforced by migration 0073):
--   firm.admin     — action_kinds ['*'], entity_kinds ['*']  → full access (admin)
--   firm.paralegal — a restricted scope: matters/clients, NO billing/firm-admin
--
-- The owner (Joe Pacheco, actor …0002) is granted firm.admin. firm.admin is a
-- pure wildcard, so the grant is transparent (the owner keeps full access) while
-- giving the app a concrete "is this actor an admin?" signal. The restricted
-- paralegal ASSIGNMENT used by the WP9.2 receipt is applied at receipt time (not
-- baked here) so a clone is not born with a deliberately hobbled actor.
--
-- Idempotent: fixed UUIDs + ON CONFLICT (id) DO NOTHING.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- Bootstrap action that "authors" the seeded governance rows (provenance).
INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                    hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
VALUES (
  '00000000-0000-0000-0074-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0013-000000000001',           -- system.bootstrap kind
  '00000000-0000-0000-0001-000000000001',           -- system actor
  'enforcement', 'autonomous',
  now(), 0, '00000000-0000-0000-0001-000000000001', '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Permission scopes.
INSERT INTO permission_scope_definition
  (id, tenant_id, action_id, scope_name, display_name, description,
   action_kinds, entity_kinds, attribute_kinds, row_filter_expression, status)
VALUES
  ('00000000-0000-0000-0074-000000000010', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0074-000000000001', 'firm.admin', 'Firm Admin (full access)',
   'Full access to every action and every entity kind. The owning attorney role.',
   '["*"]'::jsonb, '["*"]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'active'),
  ('00000000-0000-0000-0074-000000000011', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0074-000000000001', 'firm.paralegal', 'Paralegal (matters & clients, no billing)',
   'Work matters and clients; cannot touch firm settings, billing, or admin.',
   '["entity.create","attribute.set","relationship.create","legal.matter.create","legal.client.create","draft.generate"]'::jsonb,
   '["matter","client","client_contact","person","document"]'::jsonb,
   '[]'::jsonb, '{}'::jsonb, 'active')
ON CONFLICT (id) DO NOTHING;

-- Roles (named bundles of scopes; default_permission_scopes lists scope_names).
INSERT INTO role_definition
  (id, tenant_id, action_id, role_name, display_name, description, default_permission_scopes, status)
VALUES
  ('00000000-0000-0000-0074-000000000020', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0074-000000000001', 'firm.owner', 'Owner / Admin',
   'The owning attorney. Full administrative access.', '["firm.admin"]'::jsonb, 'active'),
  ('00000000-0000-0000-0074-000000000021', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0074-000000000001', 'firm.paralegal', 'Paralegal',
   'Support staff: works matters and clients, no billing or admin.', '["firm.paralegal"]'::jsonb, 'active')
ON CONFLICT (id) DO NOTHING;

-- Grant the owning attorney the admin scope (transparent wildcard; marks admin).
INSERT INTO actor_scope_assignment
  (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
VALUES
  ('00000000-0000-0000-0074-000000000030', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0074-000000000001',
   '00000000-0000-0000-0001-000000000002',           -- Joe Pacheco (owner)
   '00000000-0000-0000-0074-000000000010')           -- firm.admin
ON CONFLICT (id) DO NOTHING;

-- Self-record (invariant 12).
SELECT public.sync_migration_history();
