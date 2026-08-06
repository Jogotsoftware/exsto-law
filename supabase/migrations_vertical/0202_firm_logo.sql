-- =============================================================================
-- Vertical migration 0202: firm logo (FIRM-BRANDING-1)
--
-- ONE new attribute kind on the existing firm_profile singleton (0053; P13
-- pattern — 0161/0163/0170/0175/0178/0196/0200):
--   firm_logo  text  the firm's logo as a data URL ('data:image/png;base64,…').
--                    No default — absent means the product's scales crest /
--                    the firm's wordmark (honest unset, same posture as
--                    firm_header_color).
--
-- WHY A FIRM-LEVEL KIND AND NOT THE INVOICE TEMPLATE. Until now the only place
-- a firm could upload a logo was the INVOICE TEMPLATE config
-- (invoice_template_config.logoDataUrl on the firm_settings singleton), and
-- every other surface that wanted the logo — the attorney top bar, and now the
-- client portal, booking funnel, landing page and signing pages — had to reach
-- into a document template to find firm identity. That is backwards: the logo
-- is a FIRM fact that the invoice consumes, not an invoice fact the console
-- borrows. It now lives next to firm_header_color / firm_tagline on the
-- firm_profile singleton, and the invoice template reads it (api/firmBranding.ts
-- → api/invoiceTemplate.ts overlay).
--
-- BACKWARD COMPATIBLE BY READ, NOT BY BACKFILL. Firms that already uploaded a
-- logo (Pacheco) keep it: getFirmBranding falls back to the stored
-- invoice_template_config.logoDataUrl whenever firm_logo has never been set, so
-- nothing disappears and no data migration touches history. The first save from
-- Settings → Firm Details writes firm_logo, which then wins.
--
-- DEFINITIONS ONLY (hard rules 1, 9) — matches 0196/0200's discipline exactly;
-- no per-tenant instance data.
--
-- Id: fresh 0x21a0 sub-band (attribute 1011-...-0021a0) — verified free against
-- every migrations_vertical file up to and including 0201 AND against the prod
-- attribute_kind_definition rows (0x2100/0x2110/0x2120/0x2130/0x2150/0x2160/
-- 0x2170/0x2180/0x2190/0x2191 are taken by 0170/0171/0172/0175/0178/0180/0185/
-- 0196/0200). ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: same 0168/0170/0196/0200 idiom — tenant-zero gets the fixed id
-- below; every OTHER tenant that already has firm_profile gets the catch-up
-- loop (gen_random_uuid, idempotent by EXISTS check, not by fixed id).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile attribute (tenant-zero, fixed id) ───────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-0000000021a0', '00000000-0000-0000-0000-000000000001',
   'firm_logo', 'Logo (firm)',
   'The firm''s logo as a data URL (e.g. "data:image/png;base64,…"), stored on the firm_profile singleton. Rendered by the attorney console header, the client portal, the booking funnel, the public landing page and the invoice PDF. No default — absent renders the product''s scales crest / the firm wordmark.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: the firm_logo attribute kind for every OTHER tenant that already
-- has the firm_profile entity kind (Pacheco and any future non-dev tenant).
-- Skips tenant-zero (covered above) and any tenant that already has the kind
-- (re-run safe).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'firm_profile' AND status = 'active'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    IF NOT EXISTS (
      SELECT 1 FROM attribute_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'firm_logo'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      SELECT gen_random_uuid(), t.tenant_id, 'firm_logo', 'Logo (firm)',
             'The firm''s logo as a data URL (e.g. "data:image/png;base64,…"), stored on the firm_profile singleton. Rendered by the attorney console header, the client portal, the booking funnel, the public landing page and the invoice PDF. No default — absent renders the product''s scales crest / the firm wordmark.',
             ekd.id, 'text', false
        FROM entity_kind_definition ekd
       WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
    END IF;
  END LOOP;
END $$;
