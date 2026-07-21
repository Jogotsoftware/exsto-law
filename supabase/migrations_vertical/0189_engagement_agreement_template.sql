-- =============================================================================
-- Vertical migration 0189: firm engagement-agreement template pointer +
-- legal.firm.set_engagement_template action (ENGAGEMENT-DOC-1)
--
-- The attorney uploads their real engagement letter (PDF) in settings; the
-- parse pipeline turns it into a document template (client name/company as
-- merge fields, template_esign_config client role). This migration seeds the
-- fact that connects the two: WHICH template is the firm's engagement
-- agreement, set through a recorded action like every other firm-settings
-- write (legal.firm.set_engagement_terms sibling, 0161).
--
-- Attribute `engagement_template` on firm_settings (json):
--   { template_id, version, uploaded_at, source_filename,
--     details: { hourly_rate, litigation_rate, retainer, attorney_name } }
-- Absent = no agreement uploaded; the portal gate falls back to the
-- text-terms-only flow. The acceptance event (engagement.accepted, 0161)
-- carries agreement_document_id/template refs in its free-form payload —
-- no new event kind needed.
--
-- Ids: fresh …3200 sub-block (0188 took …3100).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000003200', '00000000-0000-0000-0000-000000000001',
       'engagement_template', 'Engagement agreement template',
       'Pointer to the document template that is the firm''s engagement agreement, plus parsed details from the uploaded letter: json {template_id, version, uploaded_at, source_filename, details}. Set via legal.firm.set_engagement_template; absent = portal gate uses text terms only.',
       ekd.id, 'json', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'firm_settings' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000003200', '00000000-0000-0000-0000-000000000001',
   'legal.firm.set_engagement_template', 'Set engagement agreement template',
   'Point the firm at the document template that is its engagement agreement (or clear the pointer). Attorney-only; the client portal gate renders the merged agreement from this template.',
   'notify', 'reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), ekd.tenant_id, 'engagement_template', 'Engagement agreement template',
       'Pointer to the document template that is the firm''s engagement agreement: json {template_id, version, uploaded_at, source_filename, details}.',
       ekd.id, 'json', false
FROM entity_kind_definition ekd
WHERE ekd.kind_name = 'firm_settings' AND ekd.status = 'active'
  AND ekd.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = ekd.tenant_id AND a.kind_name = 'engagement_template'
  );

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'legal.firm.set_engagement_template', 'Set engagement agreement template',
       'Point the firm at the document template that is its engagement agreement (or clear the pointer).',
       'notify', 'reversible', NULL, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'firm_settings' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'legal.firm.set_engagement_template'
);
