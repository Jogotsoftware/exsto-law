-- =============================================================================
-- Vertical migration 0108: per-matter workflow CUSTOMIZATION (ADR 0045, PR6)
--
-- Registers the two kinds the per-matter "edit this matter's steps" write path
-- needs. From a matter, the attorney tailors THAT one matter's workflow (add /
-- reorder / remove a step) WITHOUT touching the service's default lifecycle. The
-- tailored graph is written to workflow_instance.states_override (added in
-- migration 0093, already read by the executor/handler/matter query when present;
-- it supersedes the bound graph for that one matter — invariant 17). Today nothing
-- WRITES states_override; this migration + handler is the writer.
--
--   legal.matter.set_workflow  (action) — replace ONE matter's lifecycle graph by
--                                          writing workflow_instance.states_override
--                                          (the service default is never touched).
--                                          autonomy 'notify', reversibility
--                                          'fully_reversible' (set another override
--                                          / clear it back to the bound graph), no
--                                          reverse handler, no reasoning trace.
--   workflow.customized        (event)  — a matter's workflow GRAPH was customized
--                                          (its current_state is unchanged), so
--                                          is_state_change=false — unlike
--                                          workflow.advanced. payload: {stage_count}.
--                                          PRIMARY = matter.
--
-- The override UPDATE sets ONLY states_override; it does NOT touch state_history or
-- workflow_definition_id, so it passes BOTH 0093 BEFORE UPDATE triggers (history
-- append-only prefix + definition immutability).
--
-- Ids used (deterministic, idempotent ON CONFLICT (id) DO NOTHING; verified free vs
-- origin/main AND prod):
--   action_kind_definition  legal.matter.set_workflow  00000000-0000-0000-1013-000000000a05
--   event_kind_definition   workflow.customized        00000000-0000-0000-1014-000000000a02
-- (a01=legal.matter.advance, a02=set_lifecycle, a03/a04=step template create/update;
--  a05 is next. Event a01=workflow.advanced; a02 is next.)
--
-- Day-one: nothing reaches this without LEGAL_WORKFLOW_ENGINE=1 + an instance; the
-- edit UI only appears when a matter has a running workflow. Flag OFF is a no-op.
-- No history-sync call (matches the vertical-migration style).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── Kinds (schema-as-data) ───────────────────────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000a05', '00000000-0000-0000-0000-000000000001',
   'legal.matter.set_workflow', 'Customize this matter''s workflow',
   'Replace ONE matter''s lifecycle graph (add/reorder/remove a step) by writing workflow_instance.states_override, WITHOUT altering the service default (workflow_definition.states). The new graph is validated (closed step-action vocabulary + linear) and rejected if it would orphan the matter''s current step. Fully reversible: set another override or clear it back to the bound graph.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000a02', '00000000-0000-0000-0000-000000000001',
   'workflow.customized', 'Workflow customized',
   'A matter''s workflow GRAPH was customized for that matter only (ADR 0045). This changes the instance''s graph, not its current_state, so is_state_change=false (unlike workflow.advanced). payload holds {stage_count}. Primary=matter.',
   false)
ON CONFLICT (id) DO NOTHING;
