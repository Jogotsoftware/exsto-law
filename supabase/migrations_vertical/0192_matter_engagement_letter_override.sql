-- =============================================================================
-- Vertical migration 0192: per-matter engagement-letter override
-- (ENGAGEMENT-TEMPLATES-1 Phase 3 — the last record type)
--
-- PLANNED — the orchestrator applies it post-merge. Until applied, reads degrade
-- safely: no `matter_engagement_letter_override` attribute rows can exist without
-- the kind, so resolveContactMatterOverride returns null on the missing kind and
-- the gate resolves the per-contact override → firm default exactly as today. The
-- matter-record selector's SET fails cleanly (kind-not-found) until this lands.
--
-- Precedence at the gate is most-specific-wins: MATTER override → CONTACT override
-- → firm default (founder: "by service/matter type OR by client, but always goes
-- to firm default anyways"). The value is the engagement-letter template entity id
-- (text); absent = defer to the contact override / firm default.
--
-- Attribute on `matter` (0191's engagement_letter_override is on client_contact and
-- kind_name is unique per tenant, so the matter override needs its own kind name).
-- Action to set/clear it. Fresh …3400 id sub-block (0191 took …3300).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000003400', '00000000-0000-0000-0000-000000000001',
       'matter_engagement_letter_override', 'Engagement letter (matter override)',
       'The engagement-letter template entity id to use for THIS matter, overriding the per-contact choice and the firm default. Absent = defer to the contact override / firm default. Text = the template entity id; set via legal.matter.set_engagement_letter.',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'matter' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000003400', '00000000-0000-0000-0000-000000000001',
   'legal.matter.set_engagement_letter', 'Set matter engagement letter',
   'Choose which engagement letter applies to a specific matter (or clear back to the contact override / firm default). Attorney-only.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), ekd.tenant_id, 'matter_engagement_letter_override', 'Engagement letter (matter override)',
       'The engagement-letter template entity id for this matter, overriding the per-contact choice and the firm default (text; absent = defer to contact override / firm default).',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.kind_name = 'matter' AND ekd.status = 'active'
  AND ekd.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = ekd.tenant_id AND a.kind_name = 'matter_engagement_letter_override'
  );

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'legal.matter.set_engagement_letter', 'Set matter engagement letter',
       'Choose which engagement letter applies to a specific matter (or clear back to the contact override / firm default).',
       'notify', 'fully_reversible', NULL, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'matter' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'legal.matter.set_engagement_letter'
);

-- Client portal RBAC does NOT get this action — it is attorney-only (the client
-- never picks their own letter). No permission_scope amendment.
