-- =============================================================================
-- Vertical migration 0067: Questionnaire library
--
-- Today a questionnaire lives INSIDE a service (workflow_definition
-- transitions.intake_schema). This adds a STANDALONE, reusable questionnaire — a
-- firm-wide library (a generic client-intake form, an NDA fact sheet, …) that can
-- be authored once and attached to any service, mirroring the standalone template
-- library (migration 0023).
--
-- A questionnaire template is an ENTITY (not config) so it has its own lifecycle:
-- create / update (append-only attribute supersession) / archive (the core
-- entity.archive action — no new archive kind needed, mirrors template/client).
-- The intake schema itself is stored as a json attribute, the same shape the
-- service builder consumes (sections[].fields[]).
--
-- Id block 0700–0702 verified free across the entity (1010), attribute (1011),
-- and action (1013) ranges. Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── questionnaire_template entity kind ───────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000700', '00000000-0000-0000-0000-000000000001',
   'questionnaire_template', 'Questionnaire template',
   'A reusable intake questionnaire not bound to a service, attachable to any service.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── questionnaire_template attributes ────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000700', '00000000-0000-0000-0000-000000000001',
   'questionnaire_template_name', 'Questionnaire name', 'Human name of the questionnaire.',
   '00000000-0000-0000-1010-000000000700', 'text', false),
  ('00000000-0000-0000-1011-000000000701', '00000000-0000-0000-0000-000000000001',
   'questionnaire_template_description', 'Questionnaire description',
   'Optional short description of what this questionnaire is for.',
   '00000000-0000-0000-1010-000000000700', 'text', false),
  ('00000000-0000-0000-1011-000000000702', '00000000-0000-0000-0000-000000000001',
   'questionnaire_template_schema', 'Questionnaire schema',
   'The intake schema (sections[].fields[]) — the same shape services consume.',
   '00000000-0000-0000-1010-000000000700', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── questionnaire_template lifecycle actions (writes go through these handlers) ─
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000700', '00000000-0000-0000-0000-000000000001',
   'legal.questionnaire_template.create', 'Create questionnaire template',
   'Create a standalone, reusable intake questionnaire.',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000701', '00000000-0000-0000-0000-000000000001',
   'legal.questionnaire_template.update', 'Update questionnaire template',
   'Update a standalone questionnaire (append-only attribute supersession).',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
