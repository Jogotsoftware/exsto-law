-- =============================================================================
-- Vertical migration 0175: firm assistant instructions (WP FB-B)
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR. Written
-- and reviewed alongside the code so the number is reserved and the shape is
-- final; a future session (or the founder) applies it once #408 (WP A3, this
-- branch's base) has merged.
--
-- ONE new attribute kind on the existing firm_profile singleton (0053; P13
-- pattern, 0163_firm_profile_attorney_signature.sql, 0170_firm_jurisdiction.sql):
--   assistant_instructions  text  the firm's standing custom instructions for
--                                 the AI assistant (e.g. "always CC my
--                                 paralegal"). No default — absent means
--                                 honestly unset, never a guessed value (same
--                                 posture as firm_jurisdiction/practice_areas).
-- Writes through the EXISTING legal.firm.set_profile action (handler extended
-- in handlers/firmProfile.ts, not a new action) — same singleton, same
-- append-only supersede. Read by api/tenantSettings.ts (assistantInstructions
-- on TenantSettings/FirmProfileFields) and injected into the attorney chat's
-- stable system prompt (assistantPrompt.ts buildCustomInstructionsBlock) and
-- the email-drafting prompt (generateEmail.ts, the {{firm_instructions}} slot)
-- — never the client portal.
--
-- DEFINITIONS ONLY (hard rules 1, 9) — matches 0170's discipline exactly. No
-- per-tenant instance data is written by this migration (unlike 0170's
-- deliberate Pacheco backfill): assistant_instructions has no sensible
-- default, so every tenant starts unset and an admin opts in from
-- Settings → Assistant.
--
-- Id: fresh 0x2130 sub-band (attribute 1011-...-002130) — verified free
-- against every migrations_vertical file up to and including 0174 (the
-- 0x2100/0x2110/0x2120 sub-bands are taken by 0170/0171/0172 respectively).
-- ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: same 0168/0170 idiom — tenant-zero gets the fixed id below;
-- every OTHER tenant that already has firm_profile gets the catch-up loop
-- (gen_random_uuid, idempotent by EXISTS check, not by fixed id). Dev Firm
-- (tenant-zero) is covered by the fixed block, so the catch-up loop naturally
-- skips it.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile attribute (tenant-zero, fixed id) ───────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000002130', '00000000-0000-0000-0000-000000000001',
   'assistant_instructions', 'Assistant instructions (firm)',
   'The firm''s standing custom instructions for the AI assistant (e.g. "always CC my paralegal"), stored on the firm_profile singleton. Injected into the attorney chat system prompt and the email-drafting prompt; never the client portal. No default — absent means honestly unset.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: the assistant_instructions attribute kind for every OTHER
-- tenant that already has the firm_profile entity kind (Pacheco and any future
-- non-dev tenant). Skips tenant-zero (already covered above — EXISTS is true
-- there) and any tenant that somehow already has the kind (re-run safe).
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
      WHERE tenant_id = t.tenant_id AND kind_name = 'assistant_instructions'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO attribute_kind_definition
      (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
    SELECT gen_random_uuid(), t.tenant_id, 'assistant_instructions', 'Assistant instructions (firm)',
           'The firm''s standing custom instructions for the AI assistant (e.g. "always CC my paralegal"), stored on the firm_profile singleton. Injected into the attorney chat system prompt and the email-drafting prompt; never the client portal. No default — absent means honestly unset.',
           ekd.id, 'text', false
      FROM entity_kind_definition ekd
     WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
  END LOOP;
END $$;
