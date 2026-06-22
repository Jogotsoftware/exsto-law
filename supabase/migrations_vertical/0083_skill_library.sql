-- =============================================================================
-- Vertical migration 0083: Skill library (schema-as-data)
-- (Renumbered 0082→0083: #138 document-upload took 0082 on main/prod; billing
--  owns 0080/0081. Skill id block 0800–0806 is clear of all of them.)
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

-- ── make the skill kind available to EVERY tenant, not just tenant zero ───────
-- New tenants clone tenant zero's registries at provision time (migration 0072),
-- but kinds ADDED after a tenant was provisioned never reach it (this is why
-- Liberty Legal has `template` but not `questionnaire_template`). Backfill the
-- skill entity/attribute/action kinds into every existing non-zero tenant from
-- tenant zero's definitions. Idempotent: NOT EXISTS on (tenant_id, kind_name);
-- fresh UUIDs per tenant; on_entity_kind_id is remapped to the tenant's own skill
-- entity kind (more correct than the verbatim clone in 0072). Future tenants get
-- it for free via the standard tenant-zero clone.
DO $$
DECLARE
  zero uuid := '00000000-0000-0000-0000-000000000001';
  t    uuid;
  k    uuid;
BEGIN
  FOR t IN SELECT id FROM tenant WHERE id <> zero LOOP
    -- entity kind 'skill'
    INSERT INTO entity_kind_definition
      (id, tenant_id, kind_name, display_name, description, parent_kind_id,
       supports_temporal_state, supports_judgment, supports_outcomes, requires_period)
    SELECT gen_random_uuid(), t, z.kind_name, z.display_name, z.description, z.parent_kind_id,
           z.supports_temporal_state, z.supports_judgment, z.supports_outcomes, z.requires_period
    FROM entity_kind_definition z
    WHERE z.tenant_id = zero AND z.kind_name = 'skill'
      AND NOT EXISTS (SELECT 1 FROM entity_kind_definition b
                      WHERE b.tenant_id = t AND b.kind_name = 'skill');

    SELECT id INTO k FROM entity_kind_definition
    WHERE tenant_id = t AND kind_name = 'skill' AND status = 'active'
    ORDER BY valid_from DESC LIMIT 1;

    -- skill attributes (on_entity_kind_id remapped to this tenant's skill kind)
    INSERT INTO attribute_kind_definition
      (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
    SELECT gen_random_uuid(), t, z.kind_name, z.display_name, z.description, k, z.value_type, z.is_pii
    FROM attribute_kind_definition z
    WHERE z.tenant_id = zero
      AND z.on_entity_kind_id = (SELECT id FROM entity_kind_definition
                                 WHERE tenant_id = zero AND kind_name = 'skill' LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM attribute_kind_definition b
                      WHERE b.tenant_id = t AND b.kind_name = z.kind_name);

    -- skill lifecycle actions
    INSERT INTO action_kind_definition
      (id, tenant_id, kind_name, display_name, description, default_autonomy_tier,
       reversibility, reverse_action_kind_name, requires_reasoning_trace)
    SELECT gen_random_uuid(), t, z.kind_name, z.display_name, z.description, z.default_autonomy_tier,
           z.reversibility, z.reverse_action_kind_name, z.requires_reasoning_trace
    FROM action_kind_definition z
    WHERE z.tenant_id = zero AND z.kind_name LIKE 'legal.skill.%'
      AND NOT EXISTS (SELECT 1 FROM action_kind_definition b
                      WHERE b.tenant_id = t AND b.kind_name = z.kind_name);
  END LOOP;
END $$;
