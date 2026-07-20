-- =============================================================================
-- Vertical migration 0170: firm jurisdiction data model (WP A1)
--
-- Founder doctrine: jurisdiction is a PER-MATTER fact (from the client's
-- intake), with the firm's home jurisdiction as fallback, honest-unset
-- otherwise — services stay jurisdiction-agnostic. This migration is DATA MODEL
-- ONLY: it does not change what generateDraft / generateEmail / reviewDocument /
-- reviseDraft / assistantChat do (they still hardcode 'NC' until a later WP).
--
-- Three NEW attribute kinds on the existing firm_profile singleton (0053; P13
-- pattern, 0163_firm_profile_attorney_signature.sql):
--   firm_jurisdiction  text  the firm's home jurisdiction (short code, e.g. 'NC')
--                            — the fallback rung resolveMatterJurisdiction reads
--                            when a matter has no override. NO DEFAULT.
--   practice_areas     json  array of strings. NO DEFAULT.
--   attorney_name      text  lead attorney display name; api/tenantSettings.ts
--                            now prefers this over the legacy tenant_settings
--                            source (getTenantSettings.attorneyName).
-- All three write through the EXISTING legal.firm.set_profile action (handler
-- extended, not a new action) — same singleton, same supersession.
--
-- One NEW action kind: legal.matter.set_governing_law — lets an attorney
-- correct a matter's `governing_law` attribute after intake (that attribute
-- kind already exists: vertical seed 0001; handlers/intake.ts writes an initial
-- 'North Carolina' value at matter.open). Reuses the existing attribute kind —
-- this migration does NOT define a new one for it.
--
-- DEFINITIONS ONLY for the fixed tenant-zero block below (hard rules 1, 9) —
-- matches 0163's discipline exactly. The Pacheco backfill section further down
-- is the deliberate, explicit exception: a one-time REAL-TENANT data write, done
-- the 0168 way (an explicit `action` row for provenance, then the attribute rows
-- attributed to it) rather than assumed/defaulted in code.
--
-- Ids: fresh 0x2100 sub-band (attribute 1011-...-002100..002102, action
-- 1013-...-002100) — verified free against every migrations_vertical file up to
-- and including 0169 (highest prior use was attribute ...-002007, action/entity/
-- relationship ...-002000). ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: 0053/0163 seeded firm_profile + its identity attributes to
-- TENANT-ZERO ONLY, which was fine before a second real tenant existed. Pacheco
-- Law (ae5530a1-05c7-4241-a38e-79bd186c1bbb, FIRM-PROVISIONING-1 #348) is now
-- real and already uses legal.firm.set_profile (firm_name), so it needs these
-- THREE NEW attribute kinds too, or legal.firm.set_profile fails on Pacheco the
-- moment it's asked to write one. Fixed ids can only belong to ONE tenant, so
-- tenant-zero gets the fixed 0x2100 block below; every OTHER tenant that already
-- has firm_profile / matter gets a catch-up loop — 0168's exact DISTINCT
-- tenant_id + EXISTS-check-skip idiom (gen_random_uuid, idempotent by check, not
-- by fixed id). Dev Firm (tenant-zero) is covered by the fixed block, so the
-- catch-up loops naturally skip it (EXISTS is already true there).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile attributes (tenant-zero, fixed id block) ────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000002100', '00000000-0000-0000-0000-000000000001',
   'firm_jurisdiction', 'Firm home jurisdiction',
   'The firm''s home US jurisdiction (short state code, e.g. "NC"), stored on the firm_profile singleton. The fallback rung resolveMatterJurisdiction reads when a matter has no governing_law override. No default — absent means honestly unset.',
   '00000000-0000-0000-1010-000000000500', 'text', false),
  ('00000000-0000-0000-1011-000000002101', '00000000-0000-0000-0000-000000000001',
   'practice_areas', 'Practice areas',
   'The firm''s practice areas, a JSON array of strings, stored on the firm_profile singleton. No default — absent means honestly unset.',
   '00000000-0000-0000-1010-000000000500', 'json', false),
  ('00000000-0000-0000-1011-000000002102', '00000000-0000-0000-0000-000000000001',
   'attorney_name', 'Lead attorney name',
   'The firm''s lead attorney display name, stored on the firm_profile singleton. Preferred over the legacy tenant_settings.attorney_name source once set.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── legal.matter.set_governing_law (tenant-zero, fixed id block) ─────────────
-- Reuses the EXISTING governing_law attribute kind (vertical seed 0001) — no new
-- attribute kind here. Autonomy/reversibility mirror legal.matter.set_owner
-- (0088): a direct human write, reversible by setting again (append-only
-- history), no reasoning trace (not an AI operation).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000002100', '00000000-0000-0000-0000-000000000001',
   'legal.matter.set_governing_law', 'Set matter governing law',
   'Set or clear a matter''s governing-law override (writes the existing governing_law attribute, normalized to a US state code). Empty clears it, falling back to the firm''s home jurisdiction.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: firm_profile attributes for every OTHER tenant that already has
-- the firm_profile entity kind (Pacheco and any future non-dev tenant). Skips
-- tenant-zero (already covered above — EXISTS is true there) and any tenant that
-- somehow already has the kind (re-run safe).
DO $$
DECLARE
  t record;
  k record;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'firm_profile' AND status = 'active'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    FOR k IN
      SELECT * FROM (VALUES
        ('firm_jurisdiction', 'Firm home jurisdiction',
         'The firm''s home US jurisdiction (short state code, e.g. "NC"), stored on the firm_profile singleton. The fallback rung resolveMatterJurisdiction reads when a matter has no governing_law override. No default — absent means honestly unset.',
         'text', false),
        ('practice_areas', 'Practice areas',
         'The firm''s practice areas, a JSON array of strings, stored on the firm_profile singleton. No default — absent means honestly unset.',
         'json', false),
        ('attorney_name', 'Lead attorney name',
         'The firm''s lead attorney display name, stored on the firm_profile singleton. Preferred over the legacy tenant_settings.attorney_name source once set.',
         'text', false)
      ) AS v(kind_name, display_name, description, value_type, is_pii)
    LOOP
      IF EXISTS (
        SELECT 1 FROM attribute_kind_definition
        WHERE tenant_id = t.tenant_id AND kind_name = k.kind_name
          AND (valid_to IS NULL OR valid_to > now())
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      SELECT gen_random_uuid(), t.tenant_id, k.kind_name, k.display_name, k.description,
             ekd.id, k.value_type, k.is_pii
        FROM entity_kind_definition ekd
       WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
    END LOOP;
  END LOOP;
END $$;

-- ── Catch-up: legal.matter.set_governing_law for every OTHER tenant that
-- already has the matter entity kind. Skips tenant-zero (already covered above).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'matter' AND status = 'active'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    IF EXISTS (
      SELECT 1 FROM action_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'legal.matter.set_governing_law'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO action_kind_definition
      (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
    VALUES
      (gen_random_uuid(), t.tenant_id, 'legal.matter.set_governing_law', 'Set matter governing law',
       'Set or clear a matter''s governing-law override (writes the existing governing_law attribute, normalized to a US state code). Empty clears it, falling back to the firm''s home jurisdiction.',
       'autonomous', 'reversible_with_state_decay', NULL, false);
  END LOOP;
END $$;

-- =============================================================================
-- Pacheco Law backfill — EXPLICIT, not assumed (real tenant, FIRM-PROVISIONING-1
-- #348). The founder's actual firm home jurisdiction, lead attorney, and
-- practice area, written the 0168 provisioning-action way: an explicit `action`
-- row for provenance (config.change — the same generic provisioning kind 0168
-- used), then the attribute rows attributed to it. This is a deliberate,
-- one-time exception to "definitions only" above: real instance data for one
-- named tenant, not a definition row — idempotent (skips if firm_jurisdiction is
-- already set for this tenant) and defensive (skips with a NOTICE, does not
-- fabricate a firm_profile entity, if the singleton or provisioning scaffolding
-- isn't there yet).
-- =============================================================================

DO $$
DECLARE
  v_tenant uuid := 'ae5530a1-05c7-4241-a38e-79bd186c1bbb';
  v_firm_profile_id uuid;
  v_action uuid;
BEGIN
  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  SELECT e.id INTO v_firm_profile_id
    FROM entity e
    JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
   WHERE e.tenant_id = v_tenant AND ekd.kind_name = 'firm_profile' AND e.status = 'active'
   ORDER BY e.recorded_at ASC
   LIMIT 1;

  IF v_firm_profile_id IS NULL THEN
    RAISE NOTICE 'Pacheco tenant % has no firm_profile singleton yet; skipping jurisdiction backfill', v_tenant;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = v_tenant AND a.entity_id = v_firm_profile_id
       AND akd.kind_name = 'firm_jurisdiction'
       AND (a.valid_to IS NULL OR a.valid_to > now())
  ) THEN
    RAISE NOTICE 'Pacheco firm_jurisdiction already set; skipping backfill';
    RETURN;
  END IF;

  v_action := NULL;
  INSERT INTO action (id, tenant_id, actor_id, action_kind_id, intent_kind, autonomy_tier,
                      hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
  SELECT gen_random_uuid(), v_tenant, a.id, akd.id, 'automatic_sync', 'autonomous',
         now(), 0, a.id, '{"reason": "0170_firm_jurisdiction_pacheco_backfill"}'::jsonb
    FROM actor a
    JOIN action_kind_definition akd
      ON akd.tenant_id = v_tenant AND akd.kind_name = 'config.change'
   WHERE a.tenant_id = v_tenant AND a.actor_type = 'system' AND a.status = 'active'
   ORDER BY a.created_at
   LIMIT 1
  RETURNING id INTO v_action;

  IF v_action IS NULL THEN
    RAISE NOTICE 'Pacheco tenant % has no system actor or config.change kind; skipped', v_tenant;
    RETURN;
  END IF;

  INSERT INTO attribute (id, tenant_id, action_id, entity_id, attribute_kind_id, value,
                          confidence, knowability_state, time_precision, source_type, source_ref)
  SELECT gen_random_uuid(), v_tenant, v_action, v_firm_profile_id, akd.id, vals.val::jsonb,
         1.0, 'observed', 'exact_instant', 'system', 'system:0170_firm_jurisdiction_pacheco_backfill'
    FROM (VALUES
      ('firm_jurisdiction', '"NC"'),
      ('attorney_name', '"Juan Carlos Pacheco"'),
      ('practice_areas', '["business law"]')
    ) AS vals(kind_name, val)
    JOIN attribute_kind_definition akd
      ON akd.tenant_id = v_tenant AND akd.kind_name = vals.kind_name
     AND (akd.valid_to IS NULL OR akd.valid_to > now());
END $$;
