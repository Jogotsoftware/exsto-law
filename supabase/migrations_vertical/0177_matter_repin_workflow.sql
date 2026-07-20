-- =============================================================================
-- 0177 — legal.matter.repin_workflow action + workflow.repinned event (WF-FIX-1 WP4)
--
-- Saving a service workflow creates an immutable new version; in-flight matters
-- keep theirs (invariant 17, DB-enforced by 0093's definition-immutability
-- trigger). This action is the sanctioned path to move ONE matter to the latest
-- version: it closes the old workflow_instance (status='cancelled' — the
-- CHECK-legal "this run yields to another") and creates a successor instance
-- bound to the latest definition at a reconciled state; latest-by-started_at
-- reads make the successor win naturally, and the old instance's append-only
-- state_history survives untouched. workflow.repinned links the two instances.
--
-- Reversibility: reversible_with_state_decay — repin again after re-saving the
-- old shape; the superseded instance persists as the record of what ran before.
--
-- Ids: FRESH ...22xx sub-block (this branch's block; sibling 0176 took
-- 1014-...2200). Idempotent; per-tenant propagation rides the 0174 vocab sweep
-- migrate-vertical.mjs runs after every pass.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000002210', '00000000-0000-0000-0000-000000000001',
   'legal.matter.repin_workflow', 'Update matter to latest workflow',
   'Move one in-flight matter onto its service''s latest workflow version: close the old workflow_instance (cancelled) and create a successor bound to the latest definition at a reconciled state. Payload: matter_entity_id, target_state? (when the old stage key no longer exists), clear_override? (consent to drop a per-matter customization). Emits workflow.repinned.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000002210', '00000000-0000-0000-0000-000000000001',
   'workflow.repinned', 'Workflow repinned',
   'A matter was moved to its service''s latest workflow version. Primary=matter; payload links from/to definition ids + versions and from/to instance ids, and records state_mapped / override_cleared. The state change itself (if any) is recorded by workflow.advanced / the settle pass-through.',
   false)
ON CONFLICT (id) DO NOTHING;

-- Per-tenant propagation: migrate-vertical.mjs runs private.cp_sync_all_tenant_vocab()
-- after every pass (0174), so no explicit per-tenant copies here.
