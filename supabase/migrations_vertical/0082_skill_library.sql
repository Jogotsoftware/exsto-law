-- =============================================================================
-- Vertical migration 0082: Skill library (schema-as-data)
--
-- A "skill" is a reusable, tenant-scoped instruction asset the attorney chatbot
-- loads on demand — the legal know-how ported from anthropics/claude-for-legal
-- (NDA triage, termination review, trademark clearance, legal writing, …),
-- re-homed onto the substrate. Each skill is an ENTITY (not config) so it has its
-- own lifecycle: create / update (append-only attribute supersession) / archive
-- (the core entity.archive action — no new archive kind, mirrors template/0023 and
-- questionnaire_template/0068). The firm can edit a skill's positions or add a new
-- one without a code change (hard rule #8 — configuration is data).
--
-- The body markdown is a text attribute. The catalog the model always sees is just
-- {slug, name, practice_area, when_to_use}; the (long) body loads only when a skill
-- is triggered — progressive disclosure, so 90+ skills stay cheap at runtime.
--
-- Id block 0800–0806 verified free across the entity (1010), attribute (1011),
-- and action (1013) ranges. Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── skill entity kind ────────────────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000800', '00000000-0000-0000-0000-000000000001',
   'skill', 'Skill',
   'A reusable legal instruction asset the assistant loads on demand (ported from claude-for-legal).',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── skill attributes ─────────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000800', '00000000-0000-0000-0000-000000000001',
   'skill_slug', 'Skill slug',
   'Stable identifier, e.g. commercial.nda-review — the idempotent seed key and the load_skill handle.',
   '00000000-0000-0000-1010-000000000800', 'text', false),
  ('00000000-0000-0000-1011-000000000801', '00000000-0000-0000-0000-000000000001',
   'skill_name', 'Skill name', 'Human name of the skill.',
   '00000000-0000-0000-1010-000000000800', 'text', false),
  ('00000000-0000-0000-1011-000000000802', '00000000-0000-0000-0000-000000000001',
   'skill_practice_area', 'Practice area',
   'commercial | corporate | employment | ip | privacy | product | regulatory | ai-governance | litigation | clinic | law-student | research.',
   '00000000-0000-0000-1010-000000000800', 'text', false),
  ('00000000-0000-0000-1011-000000000803', '00000000-0000-0000-0000-000000000001',
   'skill_description', 'Description', 'One-line summary of what the skill does (shown in UI).',
   '00000000-0000-0000-1010-000000000800', 'text', false),
  ('00000000-0000-0000-1011-000000000804', '00000000-0000-0000-0000-000000000001',
   'skill_when_to_use', 'When to use',
   'Trigger description — when the assistant should load this skill. The routing signal in the catalog.',
   '00000000-0000-0000-1010-000000000800', 'text', false),
  ('00000000-0000-0000-1011-000000000805', '00000000-0000-0000-0000-000000000001',
   'skill_body', 'Body',
   'The full adapted instruction markdown the assistant follows when the skill is loaded.',
   '00000000-0000-0000-1010-000000000800', 'text', false),
  ('00000000-0000-0000-1011-000000000806', '00000000-0000-0000-0000-000000000001',
   'skill_user_invocable', 'User-invocable',
   'Whether the skill is a top-level capability (true) or a helper loaded by another skill (false).',
   '00000000-0000-0000-1010-000000000800', 'boolean', false)
ON CONFLICT (id) DO NOTHING;

-- ── skill lifecycle actions (writes go through these handlers) ────────────────
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000800', '00000000-0000-0000-0000-000000000001',
   'legal.skill.create', 'Create skill',
   'Create a reusable assistant skill (instruction asset).',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000801', '00000000-0000-0000-0000-000000000001',
   'legal.skill.update', 'Update skill',
   'Update a skill (append-only attribute supersession).',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
