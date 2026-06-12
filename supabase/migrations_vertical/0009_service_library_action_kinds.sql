-- =============================================================================
-- Vertical migration 0009: Service Library action kinds (PR1)
--
-- Makes service offerings editable in-app as VERSIONED substrate config. A
-- service is a workflow_definition row (seeded in 0001); editing one now flows
-- through the action layer like every other write (hard rule 1, invariant 9).
--
-- Two new action kinds, both autonomy 'notify' (an attorney is editing the
-- firm's own catalogue — visible, reversible, never silent) and reversible.
-- Neither requires a reasoning trace: these are configuration edits, not AI
-- judgments. v1.0.1: every action kind MUST have a registered handler — the
-- handlers ship in verticals/legal/src/handlers/serviceLibrary.ts.
--
-- Configuration-as-data: action kinds are definition ROWS, not code (hard rule
-- 8). Fixed UUIDs continue the vertical 1013 (action_kind) scheme. Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000015', '00000000-0000-0000-0000-000000000001',
   'legal.service.upsert',     'Upsert service offering',
   'Create a new service offering or save a new immutable VERSION of an existing one (seals the prior active workflow_definition row, inserts version+1).',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000016', '00000000-0000-0000-0000-000000000001',
   'legal.service.set_active', 'Enable/disable service offering',
   'Flip a service offering between active and deprecated without writing a new version (booking page lists active services only).',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
