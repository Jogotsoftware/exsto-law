-- =============================================================================
-- 0162 — CLIENT-PORTAL-UI-1 CORRECTIVE (WP-C1): the permission_scope.amend kind.
--
-- 0161 amended the client.portal allowlist with a bare in-place UPDATE: the row
-- kept its 0136 action_id and 7/10 valid_from/recorded_at while carrying kind
-- strings that did not exist until 7/14 — a provenance break (the per-tenant
-- config.change action rows 0161 inserted were never LINKED to the row). It
-- succeeded silently because permission_scope_definition — like every
-- definition table — sits outside 0018's seal-guard trigger set (fact tables
-- only). Whether definition tables should carry the guard is a logged
-- follow-up, not this hotfix.
--
-- This migration seeds the ACTION KIND only. The amendment itself fires through
-- the operation core (submitAction → handlers/permissionScope.ts), which
-- appends the kinds idempotently and re-points the row's action_id +
-- valid_from/recorded_at as the recorded action's effect. Mandatory reasoning
-- trace: an RBAC surface change always explains itself.
--
-- Id: …fa5 (0161 holds fa0–fa3; fa4 left unused as a gap guard).
-- Lease: 0162 (frontier re-verified at 0161).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000fa5', '00000000-0000-0000-0000-000000000001',
   'permission_scope.amend', 'Amend permission scope allowlist',
   'Amend an active permission_scope_definition''s action_kinds allowlist IN PLACE (the id must stay stable — actor_scope_assignment hard-binds to it, so supersession would orphan every assignment). The handler appends the named kinds idempotently and re-points the row''s action_id + valid_from/recorded_at to this action — the amendment''s provenance. Requires a reasoning trace.',
   'notify', 'reversible_with_state_decay', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Same kind for every other tenant that has a permission scope to amend.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'permission_scope.amend', 'Amend permission scope allowlist',
       'Amend an active permission_scope_definition''s action_kinds allowlist in place, with the row''s provenance re-pointed to this action. Requires a reasoning trace.',
       'notify', 'reversible_with_state_decay', NULL, true
FROM (SELECT DISTINCT tenant_id FROM permission_scope_definition) t
WHERE t.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM action_kind_definition a
    WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'permission_scope.amend'
  );
