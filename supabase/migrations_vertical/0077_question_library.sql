-- =============================================================================
-- Vertical migration 0077: Question library (a per-QUESTION reusable bank)
--
-- Migration 0068 added a reusable QUESTIONNAIRE template (a whole intake form).
-- This adds the finer grain the attorney asked for in beta feedback: a reusable
-- QUESTION — authored once, given a stable {{answer}} token, and dropped into any
-- questionnaire via an "Add from library" picker. Reusing the same question (same
-- token) across questionnaires is what lets a template's {{inserts}} bind once and
-- fill everywhere ("rapid creation of both").
--
-- A question_template is an ENTITY (not config) so it has its own lifecycle:
-- create / update (append-only attribute supersession) / archive (the core
-- entity.archive action — no new archive kind, mirrors questionnaire_template).
-- The question's answer types are the SAME KnownFieldType set the service
-- questionnaire builder emits (text/textarea/select/date/number/yes_no/
-- true_false/checkbox/…), so a library question renders identically wherever used.
--
-- Id block 0703 (entity 1010), 0703–0706 (attribute 1011), 0702–0703 (action
-- 1013) verified free on origin/main AND the live pilot DB (only 0700–0702 are
-- taken, by questionnaire_template). Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── question_template entity kind ────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000703', '00000000-0000-0000-0000-000000000001',
   'question_template', 'Question template',
   'A reusable intake question with a stable {{answer}} token, addable to any questionnaire.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── question_template attributes ─────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000703', '00000000-0000-0000-0000-000000000001',
   'question_template_label', 'Question label', 'The question text shown to the client.',
   '00000000-0000-0000-1010-000000000703', 'text', false),
  ('00000000-0000-0000-1011-000000000704', '00000000-0000-0000-0000-000000000001',
   'question_template_type', 'Answer type',
   'One of the KnownFieldType answer widgets (text, select, yes_no, checkbox, …).',
   '00000000-0000-0000-1010-000000000703', 'text', false),
  ('00000000-0000-0000-1011-000000000705', '00000000-0000-0000-0000-000000000001',
   'question_template_token', 'Answer token',
   'The stable {{answer}} key this question fills in templates (a snake_case slug). '
   'Reused verbatim as the field id wherever the question is added, so template '
   'merge-fields bind once and fill everywhere.',
   '00000000-0000-0000-1010-000000000703', 'text', false),
  ('00000000-0000-0000-1011-000000000706', '00000000-0000-0000-0000-000000000001',
   'question_template_options', 'Answer options',
   'For select / checkbox questions: the list of choices (string[]). Null otherwise.',
   '00000000-0000-0000-1010-000000000703', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── question_template lifecycle actions (writes go through these handlers) ─────
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000702', '00000000-0000-0000-0000-000000000001',
   'legal.question_template.create', 'Create question template',
   'Create a reusable library question with a stable {{answer}} token.',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000703', '00000000-0000-0000-0000-000000000001',
   'legal.question_template.update', 'Update question template',
   'Update a library question (append-only attribute supersession).',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
