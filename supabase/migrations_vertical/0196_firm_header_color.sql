-- =============================================================================
-- Vertical migration 0196: firm header color (UIWALK-1)
--
-- ONE new attribute kind on the existing firm_profile singleton (0053; P13
-- pattern — 0161/0163/0170/0175/0178):
--   firm_header_color  text  the firm's chosen top-bar/header color as a hex
--                            string ('#1b2a4a'). No default — absent means the
--                            product's standard navy header (honest unset, same
--                            posture as firm_jurisdiction).
-- Written through the EXISTING legal.firm.set_profile action (handler extended
-- in handlers/firmProfile.ts — validates '#rrggbb' or empty-to-clear). Read by
-- api/tenantSettings.ts (headerColor on TenantSettings/FirmProfileFields) and
-- rendered by the attorney top bar + Settings → Firm Details editor. The header
-- LOGO needs no new storage: it reuses the invoice-template logo
-- (legal.firm.get_invoice_template.logoDataUrl), the one place it's uploaded.
--
-- DEFINITIONS ONLY (hard rules 1, 9) — matches 0175's discipline exactly; no
-- per-tenant instance data.
--
-- Id: fresh 0x2180 sub-band (attribute 1011-...-002180) — verified free against
-- every migrations_vertical file up to and including 0195 (0x2100/0x2110/0x2120/
-- 0x2130/0x2150/0x2160/0x2170 are taken by 0170/0171/0172/0175/0180/0185(0186)/
-- 0195 respectively). ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: same 0168/0170/0175 idiom — tenant-zero gets the fixed id below;
-- every OTHER tenant that already has firm_profile gets the catch-up loop
-- (gen_random_uuid, idempotent by EXISTS check, not by fixed id).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile attribute (tenant-zero, fixed id) ───────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000002180', '00000000-0000-0000-0000-000000000001',
   'firm_header_color', 'Header color (firm)',
   'The firm''s chosen top-bar/header color as a hex string (e.g. "#1b2a4a"), stored on the firm_profile singleton. Rendered by the attorney console header. No default — absent means the product''s standard navy.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: the firm_header_color attribute kind for every OTHER tenant that
-- already has the firm_profile entity kind (Pacheco and any future non-dev
-- tenant). Skips tenant-zero (covered above) and any tenant that already has
-- the kind (re-run safe).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'firm_profile' AND status = 'active'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    IF EXISTS (
      SELECT 1 FROM attribute_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'firm_header_color'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO attribute_kind_definition
      (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
    SELECT gen_random_uuid(), t.tenant_id, 'firm_header_color', 'Header color (firm)',
           'The firm''s chosen top-bar/header color as a hex string (e.g. "#1b2a4a"), stored on the firm_profile singleton. Rendered by the attorney console header. No default — absent means the product''s standard navy.',
           ekd.id, 'text', false
      FROM entity_kind_definition ekd
     WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
  END LOOP;
END $$;
