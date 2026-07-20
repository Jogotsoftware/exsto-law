-- =============================================================================
-- Vertical migration 0178: client-portal assistant instructions (WP FB-B2)
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR. Written
-- and reviewed alongside the code so the number is reserved and the shape is
-- final; a future session (or the founder) applies it once this branch has
-- merged.
--
-- ONE new attribute kind on the existing firm_profile singleton (0053; P13
-- pattern, 0163_firm_profile_attorney_signature.sql, 0170_firm_jurisdiction.sql,
-- 0175_assistant_instructions.sql):
--   portal_assistant_instructions  text  the firm's standing guidance for the
--                                        CLIENT-FACING portal assistant (e.g.
--                                        "mention our office closes at 5pm").
--                                        A SEPARATE, client-safe field from
--                                        0175's assistant_instructions, which
--                                        stays internal-only (attorney chat +
--                                        AI-drafted email) and is never read by
--                                        the portal. No default — absent means
--                                        honestly unset, never a guessed value.
-- Writes through the EXISTING legal.firm.set_profile action (handler extended
-- in handlers/firmProfile.ts, not a new action) — same singleton, same
-- append-only supersede. Read by api/tenantSettings.ts
-- (portalAssistantInstructions on TenantSettings/FirmProfileFields) and
-- injected into the CLIENT PORTAL chat's system prompt
-- (assistantPrompt.ts buildPortalInstructionsBlock, wired into
-- clientAssistantChat.ts buildBaseSystem) — never the attorney chat or the
-- email-drafting prompt (those stay on 0175's assistant_instructions alone).
--
-- DEFINITIONS ONLY (hard rules 1, 9) — matches 0170/0175's discipline exactly.
-- No per-tenant instance data is written by this migration: every tenant
-- starts unset and an admin opts in from Settings → Assistant (the new
-- "Client portal instructions" textarea).
--
-- Id: fresh 0x2150 slot in the 1011-...-002xxx attribute-kind sub-band —
-- verified free against every migrations_vertical file up to and including
-- 0177 (…2000-…2007 taken by 0169, …2100/2101/2102 by 0170, …2110 by 0171,
-- …2120 by 0172, …2130 by 0175). ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: same 0168/0170/0175 idiom — tenant-zero gets the fixed id
-- below; every OTHER tenant that already has firm_profile gets the catch-up
-- loop (gen_random_uuid, idempotent by EXISTS check, not by fixed id). Dev
-- Firm (tenant-zero) is covered by the fixed block, so the catch-up loop
-- naturally skips it.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile attribute (tenant-zero, fixed id) ───────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000002150', '00000000-0000-0000-0000-000000000001',
   'portal_assistant_instructions', 'Assistant instructions (client portal)',
   'The firm''s standing, client-safe guidance for the CLIENT-FACING portal assistant (e.g. "mention our office closes at 5pm"), stored on the firm_profile singleton. Injected into the client portal chat system prompt only — a separate field from assistant_instructions (0175), which stays internal-only and is never read by the portal. No default — absent means honestly unset.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: the portal_assistant_instructions attribute kind for every OTHER
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
      WHERE tenant_id = t.tenant_id AND kind_name = 'portal_assistant_instructions'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO attribute_kind_definition
      (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
    SELECT gen_random_uuid(), t.tenant_id, 'portal_assistant_instructions', 'Assistant instructions (client portal)',
           'The firm''s standing, client-safe guidance for the CLIENT-FACING portal assistant (e.g. "mention our office closes at 5pm"), stored on the firm_profile singleton. Injected into the client portal chat system prompt only — a separate field from assistant_instructions (0175), which stays internal-only and is never read by the portal. No default — absent means honestly unset.',
           ekd.id, 'text', false
      FROM entity_kind_definition ekd
     WHERE ekd.tenant_id = t.tenant_id AND ekd.kind_name = 'firm_profile' AND ekd.status = 'active';
  END LOOP;
END $$;
