-- =============================================================================
-- Vertical migration 0179: skill_jurisdiction attribute (WP A5 — skills routing)
--
-- One NEW attribute kind on the EXISTING skill entity kind (0083): a skill may
-- optionally be tagged with the ONE US jurisdiction it is SPECIFIC to (a
-- canonical short code, e.g. 'DE' — normalized by the legal.skill.create/update
-- handler via api/jurisdictions.ts, handlers/skill.ts's
-- normalizeSkillJurisdictionValue). No default — absent means the skill is
-- jurisdiction-NEUTRAL (applies everywhere), which is what every seeded skill
-- stays as after this migration (DATA MODEL ONLY — no skill is tagged here;
-- content curation is a separate PR).
--
-- The resolver (skillContext.ts's rankSkillsForDraft) reads this as a NEGATIVE
-- filter: a skill tagged to a DIFFERENT jurisdiction than the one resolved for
-- a draft/review/email is excluded outright — never auto-load a Delaware
-- playbook onto a North Carolina matter. Untagged skills are never excluded on
-- jurisdiction (unaffected by this migration until something writes the attr).
--
-- DEFINITIONS ONLY (hard rules 1, 9) — no instance data written here.
--
-- Id: fresh 0x2160 slot (attribute 1011-...-002160) — verified free against
-- every migrations_vertical file up to and including 0177 on main, AND against
-- every other in-flight worktree's migrations as of this branch's cut: 0178 is
-- taken by fbb2-portal's portal_assistant_instructions (attribute
-- 1011-...-002150); other concurrent branches sit at or below 0177/2130. This
-- migration reserves 2160 to sit clear of that neighbor. ON CONFLICT (id) DO
-- NOTHING throughout, so a same-id reconcile is a no-op either way.
--
-- Multi-tenant: 0083 already backfilled the `skill` entity kind itself to every
-- tenant. This migration mirrors that exact backfill idiom for the ONE new
-- attribute kind — tenant-zero gets the fixed id below; every OTHER tenant that
-- already has the `skill` entity kind gets a catch-up loop (gen_random_uuid,
-- idempotent by NOT EXISTS check, on_entity_kind_id remapped to that tenant's
-- own skill entity kind — the same remap 0083's loop performs).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── skill_jurisdiction attribute (tenant-zero, fixed id) ─────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000002160', '00000000-0000-0000-0000-000000000001',
   'skill_jurisdiction', 'Skill jurisdiction',
   'Optional US jurisdiction (canonical short code, e.g. "DE") this skill is SPECIFIC to. Absent means jurisdiction-neutral (applies everywhere). The drafting resolver (skillContext.ts) treats a tagged skill whose jurisdiction differs from the one resolved for a draft/review/email as EXCLUDED, never as a bonus-only match.',
   '00000000-0000-0000-1010-000000000800', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: skill_jurisdiction for every OTHER tenant that already has the
-- `skill` entity kind (0083 backfilled the kind itself; this adds the one new
-- attribute kind the same way). Skips tenant-zero (already covered above).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'skill' AND status = 'active' AND tenant_id <> '00000000-0000-0000-0000-000000000001'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    IF EXISTS (
      SELECT 1 FROM attribute_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'skill_jurisdiction'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO attribute_kind_definition
      (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
    SELECT gen_random_uuid(), t.tenant_id, 'skill_jurisdiction', 'Skill jurisdiction',
           'Optional US jurisdiction (canonical short code, e.g. "DE") this skill is SPECIFIC to. Absent means jurisdiction-neutral (applies everywhere). The drafting resolver (skillContext.ts) treats a tagged skill whose jurisdiction differs from the one resolved for a draft/review/email as EXCLUDED, never as a bonus-only match.',
           ekd.id, 'text', false
      FROM entity_kind_definition ekd
     WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'skill' AND ekd.status = 'active';
  END LOOP;
END $$;
