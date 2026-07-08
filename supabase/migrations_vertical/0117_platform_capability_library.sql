-- =============================================================================
-- Vertical migration 0117: Platform capability library (schema-as-data)
--
-- A living registry of EVERYTHING the platform can do — AI document review,
-- native e-signature, booking, invoicing, Stripe/manual payments, client portal,
-- mail, the template/questionnaire editors, the workflow engine, trust
-- accounting, Granola import, document generation, and whatever ships next. The
-- service-builder chatbot reads this catalog to decide REUSE vs. BUILD-FROM-
-- SCRATCH, and it grows over time: a Tier-3 gap the builder can't compose is
-- filed here as a `requested` capability, and flips to `available` when the team
-- builds it. So the builder always knows the current surface of the platform.
--
-- Each capability is an ENTITY (its own lifecycle: upsert by stable slug,
-- archive via the core entity.archive) with three attributes:
--   capability_slug   (text)  — stable id + idempotent seed/upsert key
--   capability_status (text)  — available | building | requested | deprecated
--   capability_spec   (json)  — { name, category, purpose, when_to_use,
--                                 backed_by[], docs_path? } — the catalog the
--                                 builder reads (name/purpose/when-to-use + what
--                                 workflow step / tool / feature backs it).
--
-- Id block 1018 verified free across entity(1010)/attribute(1011)/action(1013)
-- ranges. Migration number 0117 is above main+prod max (0116). Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── platform_capability entity kind ──────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1018-000000000001', '00000000-0000-0000-0000-000000000001',
   'platform_capability', 'Platform capability',
   'A feature/tool the platform can do (e.g. e-signature, document review), catalogued so the builder knows what to reuse vs. build. Living registry — grows as capabilities ship.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── platform_capability attributes ───────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000001801', '00000000-0000-0000-0000-000000000001',
   'capability_slug', 'Capability slug',
   'Stable identifier, e.g. ai_document_review — the idempotent upsert key and the builder handle.',
   '00000000-0000-0000-1018-000000000001', 'text', false),
  ('00000000-0000-0000-1011-000000001802', '00000000-0000-0000-0000-000000000001',
   'capability_status', 'Capability status',
   'available | building | requested | deprecated. requested = filed by the builder as a gap not yet implemented.',
   '00000000-0000-0000-1018-000000000001', 'text', false),
  ('00000000-0000-0000-1011-000000001803', '00000000-0000-0000-0000-000000000001',
   'capability_spec', 'Capability spec',
   'JSON: { name, category, purpose, when_to_use, backed_by[], docs_path? } — the catalog the service-builder reads.',
   '00000000-0000-0000-1018-000000000001', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── capability lifecycle action (writes go through this handler) ──────────────
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000001801', '00000000-0000-0000-0000-000000000001',
   'legal.capability.upsert', 'Upsert platform capability',
   'Register or update a platform capability in the living library (create by slug, or supersede its status/spec).',
   'notify', 'fully_reversible', 'entity.archive', false)
ON CONFLICT (id) DO NOTHING;

-- ── make the capability kind available to EVERY tenant, not just tenant zero ──
-- Same backfill discipline as 0083 (skills): kinds added after a tenant was
-- provisioned never reach it via the 0072 clone, so backfill from tenant zero.
-- Idempotent: NOT EXISTS on (tenant_id, kind_name); fresh UUIDs per tenant;
-- on_entity_kind_id remapped to the tenant's own platform_capability kind.
DO $$
DECLARE
  zero uuid := '00000000-0000-0000-0000-000000000001';
  t    uuid;
  k    uuid;
BEGIN
  FOR t IN SELECT id FROM tenant WHERE id <> zero LOOP
    INSERT INTO entity_kind_definition
      (id, tenant_id, kind_name, display_name, description, parent_kind_id,
       supports_temporal_state, supports_judgment, supports_outcomes, requires_period)
    SELECT gen_random_uuid(), t, z.kind_name, z.display_name, z.description, z.parent_kind_id,
           z.supports_temporal_state, z.supports_judgment, z.supports_outcomes, z.requires_period
    FROM entity_kind_definition z
    WHERE z.tenant_id = zero AND z.kind_name = 'platform_capability'
      AND NOT EXISTS (SELECT 1 FROM entity_kind_definition b
                      WHERE b.tenant_id = t AND b.kind_name = 'platform_capability');

    SELECT id INTO k FROM entity_kind_definition
    WHERE tenant_id = t AND kind_name = 'platform_capability' AND status = 'active'
    ORDER BY valid_from DESC LIMIT 1;

    INSERT INTO attribute_kind_definition
      (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
    SELECT gen_random_uuid(), t, z.kind_name, z.display_name, z.description, k, z.value_type, z.is_pii
    FROM attribute_kind_definition z
    WHERE z.tenant_id = zero
      AND z.on_entity_kind_id = (SELECT id FROM entity_kind_definition
                                 WHERE tenant_id = zero AND kind_name = 'platform_capability' LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM attribute_kind_definition b
                      WHERE b.tenant_id = t AND b.kind_name = z.kind_name);

    INSERT INTO action_kind_definition
      (id, tenant_id, kind_name, display_name, description, default_autonomy_tier,
       reversibility, reverse_action_kind_name, requires_reasoning_trace)
    SELECT gen_random_uuid(), t, z.kind_name, z.display_name, z.description, z.default_autonomy_tier,
           z.reversibility, z.reverse_action_kind_name, z.requires_reasoning_trace
    FROM action_kind_definition z
    WHERE z.tenant_id = zero AND z.kind_name = 'legal.capability.upsert'
      AND NOT EXISTS (SELECT 1 FROM action_kind_definition b
                      WHERE b.tenant_id = t AND b.kind_name = z.kind_name);
  END LOOP;
END $$;
