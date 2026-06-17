-- =============================================================================
-- Vertical migration 0023: Standalone templates (beta sprint Objective 9)
--
-- Every template today is bound to a service (transitions.intake_schema /
-- document_templates / drafting). This adds a STANDALONE template: a reusable
-- document or email template not tied to any service, so the firm can keep a
-- library (a generic NDA body, a stock follow-up email, …) usable across matters
-- regardless of which service opened them. The Templates tab (Obj 9) lists these
-- alongside the service-bound ones.
--
-- A standalone template is an ENTITY (not config) so it has its own lifecycle:
-- create / update (append-only attribute supersession) / archive (the core
-- entity.archive action — no new archive kind needed, mirrors client).
--
-- Ids verified free against the live pilot DB (entity ≤0007, attribute ≤0030,
-- action ≤0022). Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── template entity kind ─────────────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000008', '00000000-0000-0000-0000-000000000001',
   'template', 'Template', 'A reusable document or email template not bound to a service.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── template attributes ──────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000031', '00000000-0000-0000-0000-000000000001',
   'template_name',     'Template name',     'Human name of the template.',
   '00000000-0000-0000-1010-000000000008', 'text', false),
  ('00000000-0000-0000-1011-000000000032', '00000000-0000-0000-0000-000000000001',
   'template_category', 'Template category', 'document | email — which kind of template this is.',
   '00000000-0000-0000-1010-000000000008', 'enum', false),
  ('00000000-0000-0000-1011-000000000033', '00000000-0000-0000-0000-000000000001',
   'template_body',     'Template body',     'The template content (markdown / text, may contain {{tokens}}).',
   '00000000-0000-0000-1010-000000000008', 'text', false),
  ('00000000-0000-0000-1011-000000000034', '00000000-0000-0000-0000-000000000001',
   'template_doc_kind', 'Document kind',     'Optional document kind tag for a document template (e.g. nda).',
   '00000000-0000-0000-1010-000000000008', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── template lifecycle actions (writes go through these handlers) ─────────────
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000023', '00000000-0000-0000-0000-000000000001',
   'legal.template.create', 'Create template', 'Create a standalone document/email template.',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000024', '00000000-0000-0000-0000-000000000001',
   'legal.template.update', 'Update template', 'Update a standalone template (append-only attribute supersession).',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
