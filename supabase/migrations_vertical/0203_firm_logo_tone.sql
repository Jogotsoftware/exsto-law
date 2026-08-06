-- =============================================================================
-- Vertical migration 0203: firm logo tone (FIRM-BRANDING-1)
--
-- ONE new attribute kind on the existing firm_profile singleton (0053; P13
-- pattern — 0161/0163/0170/0175/0178/0196/0200/0202):
--   firm_logo_tone  text  'light' or 'dark' — the tone of the INK in the firm's
--                         uploaded logo (0202). No default; absent means
--                         "unknown", and every surface renders the logo bare
--                         (today's behaviour, no regression).
--
-- WHY THIS EXISTS. Firms upload ONE logo file, and roughly half of them are
-- "reversed" artwork — a white wordmark drawn for a dark website header (the
-- pilot firm's is exactly this: white type, gold crest). Dropped on a white
-- invoice or a cream booking page that logo is invisible; dropped on a navy
-- console bar a dark-ink logo is equally invisible. Neither the CSS nor the PDF
-- renderer can tell which it is by looking at a data URL, and guessing one
-- backdrop breaks the other half of firms. So the ONE fact that resolves it is
-- captured where it is knowable for free — the uploader measures the artwork's
-- average luminance on a canvas at upload time — and stored as a firm fact the
-- browser AND the server-side invoice renderer both read.
--
-- DEFINITIONS ONLY (hard rules 1, 9) — matches 0202's discipline exactly; no
-- per-tenant instance data.
--
-- Id: 0x21a1, the sibling of 0202's 0x21a0 (that migration claimed the 0x21a0
-- sub-band for firm branding). Verified free against every migrations_vertical
-- file and against the prod attribute_kind_definition rows.
-- ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: same 0196/0200/0202 idiom — tenant-zero gets the fixed id
-- below; every OTHER tenant that already has firm_profile gets the catch-up
-- loop (gen_random_uuid, idempotent by EXISTS check, not by fixed id).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile attribute (tenant-zero, fixed id) ───────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-0000000021a1', '00000000-0000-0000-0000-000000000001',
   'firm_logo_tone', 'Logo tone (firm)',
   'Whether the ink in the firm''s uploaded logo is ''light'' (reversed artwork made for a dark header — needs a dark backdrop on light surfaces) or ''dark'' (made for white paper — needs a light chip on dark chrome). Measured by the uploader from the image itself. Absent means unknown: surfaces render the logo bare.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: the firm_logo_tone attribute kind for every OTHER tenant that
-- already has the firm_profile entity kind. Skips tenant-zero (covered above)
-- and any tenant that already has the kind (re-run safe).
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
      WHERE tenant_id = t.tenant_id AND kind_name = 'firm_logo_tone'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      SELECT gen_random_uuid(), t.tenant_id, 'firm_logo_tone', 'Logo tone (firm)',
             'Whether the ink in the firm''s uploaded logo is ''light'' (reversed artwork made for a dark header — needs a dark backdrop on light surfaces) or ''dark'' (made for white paper — needs a light chip on dark chrome). Measured by the uploader from the image itself. Absent means unknown: surfaces render the logo bare.',
             ekd.id, 'text', false
        FROM entity_kind_definition ekd
       WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
    END IF;
  END LOOP;
END $$;
