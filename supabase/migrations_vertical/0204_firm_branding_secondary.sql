-- =============================================================================
-- Vertical migration 0204: secondary brand color + header logo
-- (BRANDING-SECTION-1)
--
-- THREE new attribute kinds on the existing firm_profile singleton (0053; P13
-- pattern — 0161/0163/0170/0175/0178/0196/0200/0202/0203):
--   firm_secondary_color      text  the firm's SECOND brand color as '#rrggbb'.
--   firm_logo_secondary       text  a second logo (image data URL) used ONLY on
--                                   the attorney console header bar.
--   firm_logo_secondary_tone  text  'light' | 'dark' for that second logo's ink,
--                                   measured by the uploader (same as 0203).
-- All three: no default. Absent means today's behaviour exactly (see below), so
-- no existing firm changes appearance when this lands.
--
-- NOTE ON TONE. 0203 introduced firm_logo_tone and surfaces used it to paint an
-- automatic plate/box behind reversed artwork. That backdrop is REMOVED in this
-- change (founder call: "i dont like that its automatically adding the box and
-- background around the logo") — uploaded artwork now renders bare at its
-- natural proportions everywhere. Both tone attributes survive as what they
-- always literally were: a measured fact about the artwork. Their only consumer
-- now is ADVISORY — the uploader tells the attorney when a light-ink mark will
-- be hard to see on light pages and points them at the header-logo slot. Tone
-- never paints anything again.
--
-- WHY A SECONDARY COLOR. Until now every accent on every surface was DERIVED
-- from the one firm_header_color (0196) by darkening it: --li-brand-deep
-- (console rail) = brand darkened 18%, --fl-brand-deep / --fl-brand-icon
-- (landing, 0536) = 28% / 10%, --bk-brand-deep (booking funnel) = 12%. That is a
-- good default — one color and the whole family stays related — but a real firm
-- brand is usually a PAIR (navy + gold, maroon + cream), and no amount of
-- darkening one of them produces the other. firm_secondary_color OVERRIDES the
-- derived companion tone wherever one is used; unset, the derivation is
-- untouched. That is the whole contract: an override, never a new requirement.
--
-- WHY A SECOND LOGO. The firm logo (0202) is the firm-wide asset — it prints on
-- invoices, fills the client-portal band, the booking funnel, the public landing
-- page, the OG card and the signing pages. The attorney console header bar is a
-- different problem: it is a narrow dark strip, and the artwork that reads well
-- on a white invoice is often the wrong variant for it (firms routinely keep a
-- compact or reversed lockup for exactly this). firm_logo_secondary is that
-- variant, and it is scoped deliberately: the console header only. Unset, the
-- header falls back to firm_logo exactly as it does today. It is NOT part of
-- legal.public.firm_branding / PublicFirmSite — console chrome is not public
-- surface, and the public closed shape stays closed.
--
-- DEFINITIONS ONLY (hard rules 1, 9) — matches 0202/0203's discipline exactly;
-- no per-tenant instance data.
--
-- Id: fresh 0x21b0 sub-band (attribute 1011-...-0021b0/b1/b2) — verified free
-- against every migrations_vertical file up to and including 0203 AND against
-- the prod attribute_kind_definition rows (0x2190/0x2191 are 0200's
-- firm_tagline/firm_about; 0x21a0/0x21a1 are 0202/0203's firm_logo/
-- firm_logo_tone; nothing occupies 0x21b*). ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: same 0196/0200/0202/0203 idiom — tenant-zero gets the fixed ids
-- below; every OTHER tenant that already has firm_profile gets the catch-up
-- loop (gen_random_uuid, idempotent by EXISTS check, not by fixed id).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile attributes (tenant-zero, fixed ids) ─────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-0000000021b0', '00000000-0000-0000-0000-000000000001',
   'firm_secondary_color', 'Secondary color (firm)',
   'The firm''s secondary brand color as a hex string (e.g. "#a6812f"), stored on the firm_profile singleton. Overrides the companion/accent tone that is otherwise derived by darkening firm_header_color — the console rail, the landing page''s deep/icon inks and the booking funnel''s deep tone. No default: absent means those tones stay derived from the primary color.',
   '00000000-0000-0000-1010-000000000500', 'text', false),
  ('00000000-0000-0000-1011-0000000021b1', '00000000-0000-0000-0000-000000000001',
   'firm_logo_secondary', 'Header logo (firm)',
   'A SECOND logo as a data URL (e.g. "data:image/png;base64,…"), used only on the attorney console header bar in place of firm_logo. For firms whose main mark is the wrong variant for a narrow dark strip. No default: absent means the header shows firm_logo. Never rendered on public/client surfaces.',
   '00000000-0000-0000-1010-000000000500', 'text', false),
  ('00000000-0000-0000-1011-0000000021b2', '00000000-0000-0000-0000-000000000001',
   'firm_logo_secondary_tone', 'Header logo tone (firm)',
   'Whether the ink in the firm''s header logo (firm_logo_secondary) is ''light'' (reversed artwork made for a dark backdrop) or ''dark'' (made for paper). Measured by the uploader from the image itself, same as firm_logo_tone. ADVISORY ONLY — it never paints a plate or box behind the logo; the uploader uses it to warn that a light mark may be hard to see on light pages. Absent means unknown.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: the three kinds for every OTHER tenant that already has the
-- firm_profile entity kind (Pacheco and any future non-dev tenant). Skips
-- tenant-zero (covered above) and any tenant/kind pair that already exists
-- (re-run safe).
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
        ('firm_secondary_color', 'Secondary color (firm)',
         'The firm''s secondary brand color as a hex string (e.g. "#a6812f"), stored on the firm_profile singleton. Overrides the companion/accent tone that is otherwise derived by darkening firm_header_color — the console rail, the landing page''s deep/icon inks and the booking funnel''s deep tone. No default: absent means those tones stay derived from the primary color.'),
        ('firm_logo_secondary', 'Header logo (firm)',
         'A SECOND logo as a data URL (e.g. "data:image/png;base64,…"), used only on the attorney console header bar in place of firm_logo. For firms whose main mark is the wrong variant for a narrow dark strip. No default: absent means the header shows firm_logo. Never rendered on public/client surfaces.'),
        ('firm_logo_secondary_tone', 'Header logo tone (firm)',
         'Whether the ink in the firm''s header logo (firm_logo_secondary) is ''light'' (reversed artwork made for a dark backdrop) or ''dark'' (made for paper). Measured by the uploader from the image itself, same as firm_logo_tone. ADVISORY ONLY — it never paints a plate or box behind the logo; the uploader uses it to warn that a light mark may be hard to see on light pages. Absent means unknown.')
      ) AS v(kind_name, display_name, description)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM attribute_kind_definition
        WHERE tenant_id = t.tenant_id AND kind_name = k.kind_name
          AND (valid_to IS NULL OR valid_to > now())
      ) THEN
        INSERT INTO attribute_kind_definition
          (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
        SELECT gen_random_uuid(), t.tenant_id, k.kind_name, k.display_name, k.description,
               ekd.id, 'text', false
          FROM entity_kind_definition ekd
         WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
      END IF;
    END LOOP;
  END LOOP;
END $$;
