-- =============================================================================
-- Vertical migration 0193: client profile details captured at intake sign-up
-- (PORTAL signup part 2)
--
-- The /book funnel gains a "details" step after the contact step that captures
-- CLIENT-level facts a firm needs on file but the questionnaire never asked:
-- the client's mailing address, and — when they mark themselves a business —
-- the business address (the business NAME reuses the existing `company_name`
-- kind, which the contact step already collects). Plus the client's preferred
-- way to be reached.
--
-- These are first-class attributes on the client_contact (reusable across every
-- matter), NOT per-service questionnaire answers. They ride the EXISTING
-- intake.submit action (no new action kind) — the handler writes them when the
-- funnel supplies them.
--
-- Fresh …3500 id sub-block (0191 took …3300, 0192 …3400). Addresses are stored
-- as the same structured JSON shape the questionnaire's address_autocomplete
-- fields use (formatted_address + components), so `json` + is_pii.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── Tenant-zero (the definition template every new tenant is seeded from) ──────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000003500', '00000000-0000-0000-0000-000000000001',
       'mailing_address', 'Mailing address',
       'The client''s mailing/home address as structured JSON (formatted_address + street/city/state/postal_code/country). Captured on the booking sign-up details step; reusable across all of the client''s matters.',
       ekd.id, 'json', true
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'client_contact' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000003501', '00000000-0000-0000-0000-000000000001',
       'business_address', 'Business address',
       'The client''s business address as structured JSON, set only when the client marks themselves a business. The business NAME is the existing company_name attribute.',
       ekd.id, 'json', true
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'client_contact' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000003502', '00000000-0000-0000-0000-000000000001',
       'preferred_contact_method', 'Preferred contact method',
       'How the client prefers to be reached: one of email | phone | text. Captured on the booking sign-up details step.',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'client_contact' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), ekd.tenant_id, 'mailing_address', 'Mailing address',
       'The client''s mailing/home address as structured JSON (formatted_address + components). Reusable across the client''s matters.',
       ekd.id, 'json', true
FROM entity_kind_definition ekd
WHERE ekd.kind_name = 'client_contact' AND ekd.status = 'active'
  AND ekd.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = ekd.tenant_id AND a.kind_name = 'mailing_address'
  );

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), ekd.tenant_id, 'business_address', 'Business address',
       'The client''s business address as structured JSON, set only when the client is a business.',
       ekd.id, 'json', true
FROM entity_kind_definition ekd
WHERE ekd.kind_name = 'client_contact' AND ekd.status = 'active'
  AND ekd.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = ekd.tenant_id AND a.kind_name = 'business_address'
  );

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), ekd.tenant_id, 'preferred_contact_method', 'Preferred contact method',
       'How the client prefers to be reached: email | phone | text.',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.kind_name = 'client_contact' AND ekd.status = 'active'
  AND ekd.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = ekd.tenant_id AND a.kind_name = 'preferred_contact_method'
  );
