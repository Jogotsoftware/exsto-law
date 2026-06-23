-- =============================================================================
-- Vertical migration 0101: Workflow STEP / TASK library (ADR 0045, PR4c)
-- (Renumbered 0095→0101: #213's control-plane chain also took 0095-0100 — two
--  0095 files on main broke the migration runner + invariants. This one is
--  standalone; the #213 chain has internal deps, so it kept 0095-0100.)
--
-- Today a workflow step lives INSIDE a service (workflow_definition.states[] —
-- one LifecycleStage). This adds a STANDALONE, reusable STEP — a firm-wide
-- library of saved steps the make.com-style Workflow builder can drop into any
-- service. (Whole-workflow templates are a LATER PR; this is reusable STEPS only.)
-- It mirrors the questionnaire library (migration 0068) and standalone template
-- library exactly: an entity with json config, create/update through the action
-- layer, archive via the core entity.archive.
--
-- A workflow_step_template is an ENTITY (not config) so it has its own lifecycle:
-- create / update (append-only attribute supersession) / archive (the core
-- entity.archive action — no new archive kind needed, mirrors questionnaire/
-- template/client). The reusable STAGE is stored as one json attribute holding a
-- LifecycleStage WITHOUT `advances_to` — a saved step carries its label/action/
-- gate/documents/blocking, but NO edges: a half-edge (an `advances_to` to a stage
-- that isn't in the target workflow) would fail validateLifecycle (resolve.ts).
-- The builder assigns the outgoing edge + default gate at INSERTION time, exactly
-- as it does for a catalog add.
--
-- Ids (deterministic, idempotent ON CONFLICT (id) DO NOTHING):
--   entity_kind_definition     workflow_step_template
--     00000000-0000-0000-1010-000000000a01
--   attribute_kind_definition  workflow_step_template_{name,description,stage}
--     00000000-0000-0000-1011-000000000a0{1,2,3}
--   action_kind_definition     legal.workflow_step_template.{create,update}
--     00000000-0000-0000-1013-000000000a0{3,4}
--       (the a0x action block is the workflow engine's: a01 = legal.matter.advance
--        [0093], a02 = legal.service.set_lifecycle [0094]; a03/a04 verified free.)
--
-- All ids verified free vs prod (project jfcarzprfpoztxuqykoe — no -1010-…a*,
-- -1011-…a*, or -1013-…a* rows) AND vs origin/main's migration tree.
-- Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── workflow_step_template entity kind ───────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000a01', '00000000-0000-0000-0000-000000000001',
   'workflow_step_template', 'Workflow step template',
   'A reusable workflow STEP (a LifecycleStage without edges) saved from the Workflow builder and droppable into any service.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── workflow_step_template attributes ────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000a01', '00000000-0000-0000-0000-000000000001',
   'workflow_step_template_name', 'Step name', 'Human name of the saved step.',
   '00000000-0000-0000-1010-000000000a01', 'text', false),
  ('00000000-0000-0000-1011-000000000a02', '00000000-0000-0000-0000-000000000001',
   'workflow_step_template_description', 'Step description',
   'Optional short description of what this saved step is for.',
   '00000000-0000-0000-1010-000000000a01', 'text', false),
  ('00000000-0000-0000-1011-000000000a03', '00000000-0000-0000-0000-000000000001',
   'workflow_step_template_stage', 'Step stage',
   'The reusable LifecycleStage (label, action {kind,config?}, gate, documents?, blocking?) — WITHOUT advances_to. The builder assigns edges at insertion time.',
   '00000000-0000-0000-1010-000000000a01', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── workflow_step_template lifecycle actions (writes go through these handlers) ─
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000a03', '00000000-0000-0000-0000-000000000001',
   'legal.workflow_step_template.create', 'Create workflow step template',
   'Create a standalone, reusable workflow step (a LifecycleStage without edges) in the firm library.',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000a04', '00000000-0000-0000-0000-000000000001',
   'legal.workflow_step_template.update', 'Update workflow step template',
   'Update a standalone workflow step template (append-only attribute supersession).',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
