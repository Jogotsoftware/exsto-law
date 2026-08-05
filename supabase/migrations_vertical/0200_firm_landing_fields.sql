-- =============================================================================
-- Vertical migration 0200: firm public landing page fields (FIRM-LANDING-2)
--
-- TWO new attribute kinds on the existing firm_profile singleton (0053; P13
-- pattern — 0161/0163/0170/0175/0178/0196):
--   firm_tagline  text  the short hero line the firm's public landing page
--                       ({slug}.instruments.legal) shows under the firm name
--                       (e.g. 'Business law for North Carolina founders').
--                       No default — absent renders the product's generic line.
--   firm_about    text  a public "about the firm" paragraph for the landing
--                       page. No default — absent hides the section entirely
--                       (honest unset, same posture as firm_jurisdiction).
-- The public CONTACT block needs no new storage: firm_phone / firm_email /
-- firm_address already exist (0161) and the landing page only renders the ones
-- that are set. Written through the EXISTING legal.firm.set_profile action
-- (handler extended in handlers/firmProfile.ts — trims, caps length, ''
-- clears). Read by api/tenantSettings.ts (tagline/about on TenantSettings/
-- FirmProfileFields) and the public-safe api/publicSite.ts getPublicFirmSite,
-- rendered by apps/legal-demo FirmLandingPage + Settings → Firm Details.
--
-- DEFINITIONS ONLY (hard rules 1, 9) — matches 0196's discipline exactly; no
-- per-tenant instance data.
--
-- Ids: fresh 0x2190 sub-band (attributes 1011-...-002190 / 1011-...-002191) —
-- verified free against every migrations_vertical file up to and including
-- 0199 (0x2180 was taken by 0196; 0197/0198/0199 mint no attribute kinds).
-- ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: same 0168/0170/0196 idiom — tenant-zero gets the fixed ids
-- below; every OTHER tenant that already has firm_profile gets the catch-up
-- loop (gen_random_uuid, idempotent by EXISTS check, not by fixed id).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile attributes (tenant-zero, fixed ids) ─────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000002190', '00000000-0000-0000-0000-000000000001',
   'firm_tagline', 'Tagline (public page)',
   'The short hero line the firm''s public landing page shows under the firm name. No default — absent renders the product''s generic line.',
   '00000000-0000-0000-1010-000000000500', 'text', false),
  ('00000000-0000-0000-1011-000000002191', '00000000-0000-0000-0000-000000000001',
   'firm_about', 'About (public page)',
   'A public "about the firm" paragraph for the firm''s landing page. No default — absent hides the section.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: both landing attribute kinds for every OTHER tenant that already
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
      WHERE tenant_id = t.tenant_id AND kind_name = 'firm_tagline'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      SELECT gen_random_uuid(), t.tenant_id, 'firm_tagline', 'Tagline (public page)',
             'The short hero line the firm''s public landing page shows under the firm name. No default — absent renders the product''s generic line.',
             ekd.id, 'text', false
        FROM entity_kind_definition ekd
       WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM attribute_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'firm_about'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      SELECT gen_random_uuid(), t.tenant_id, 'firm_about', 'About (public page)',
             'A public "about the firm" paragraph for the firm''s landing page. No default — absent hides the section.',
             ekd.id, 'text', false
        FROM entity_kind_definition ekd
       WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
    END IF;
  END LOOP;
END $$;
