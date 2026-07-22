-- =============================================================================
-- Vertical migration 0191: per-contact engagement-letter override
-- (ENGAGEMENT-TEMPLATES-1 Phase 2)
--
-- PLANNED — the orchestrator applies it post-merge. Until applied, reads degrade
-- safely: no `engagement_letter_override` attribute rows can exist without the
-- kind, so getClientEngagementAgreement resolves the FIRM DEFAULT for every
-- client exactly as today (getContactEngagementOverride returns null on a missing
-- kind). The CRM "Engagement letter" selector's SET fails cleanly (kind-not-found)
-- until this lands — the read side never breaks.
--
-- A firm keeps a library of engagement letters (Phase 1); this lets a specific
-- CLIENT sign a chosen letter instead of the firm default. The value is the
-- template entity id (text); absent = use the firm default. The gate always falls
-- back to the default (founder: "always goes to firm default anyways").
--
-- Attribute on client_contact; action to set/clear it. Fresh …3300 id sub-block
-- (0188 took …3100, 0189 …3200).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000003300', '00000000-0000-0000-0000-000000000001',
       'engagement_letter_override', 'Engagement letter (override)',
       'The engagement-letter template entity id this specific client signs instead of the firm default. Absent = the firm default. Text = the template entity id; set via legal.contact.set_engagement_letter.',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'client_contact' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000003300', '00000000-0000-0000-0000-000000000001',
   'legal.contact.set_engagement_letter', 'Set contact engagement letter',
   'Choose which engagement letter a specific client signs (or clear back to the firm default). Attorney-only.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), ekd.tenant_id, 'engagement_letter_override', 'Engagement letter (override)',
       'The engagement-letter template entity id this client signs instead of the firm default (text; absent = firm default).',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.kind_name = 'client_contact' AND ekd.status = 'active'
  AND ekd.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = ekd.tenant_id AND a.kind_name = 'engagement_letter_override'
  );

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'legal.contact.set_engagement_letter', 'Set contact engagement letter',
       'Choose which engagement letter a specific client signs (or clear back to the firm default).',
       'notify', 'fully_reversible', NULL, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'client_contact' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'legal.contact.set_engagement_letter'
);

-- Client portal RBAC does NOT get this action — it is attorney-only (the client
-- never picks their own letter). No permission_scope amendment.
