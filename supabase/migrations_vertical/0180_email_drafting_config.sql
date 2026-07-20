-- =============================================================================
-- Vertical migration 0180: email drafting prompt + house-voice config (WP FB-D)
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR. Written
-- and reviewed alongside the code so the number is reserved and the shape is
-- final; a future session (or the founder) applies it once this branch has
-- merged. Until applied, reads degrade safely to the bundled repo templates
-- (no attribute rows can exist without the kind) and a save attempt throws a
-- clear "kind not found" error — the same posture 0175/0178 left their code in
-- before they landed.
--
-- Config-first email drafting (mirrors the document drafting-prompt seam —
-- REQUIRED_DRAFTING_SLOTS / getDraftingPrompt / updateDraftingPrompt in
-- services.ts — but email is FIRM-WIDE, not per-service, so it lives on the
-- firm_settings singleton (0065; Contract K precedent: one JSON config
-- attribute per feature, exactly like invoice_template_config (0081) and
-- manual_payment_methods_config (0115)) rather than workflow_definition.
--
-- Adds:
--   • attribute kind  email_drafting_config (json, firm_settings)
--       { prompt_version: number,
--         prompt_text: string | null,       -- override for
--                                            -- templates/email-drafting-prompt.md
--         house_voice_text: string | null } -- override for
--                                            -- templates/house-voice.md
--     Either half independently null = "use the repo default". A new write
--     supersedes the prior config append-only (effective-dated).
--   • action kind     legal.firm.set_email_drafting_config
--     Written through api/emailDraftingConfig.ts (updateEmailDraftingConfig),
--     which validates a non-empty prompt override's required mustache slots
--     and bumps prompt_version before submitting — the handler
--     (handlers/firmSettings.ts) stores the already-resolved config verbatim,
--     same discipline as legal.firm.set_invoice_template /
--     legal.firm.set_manual_payment_methods.
--
-- Configuration-as-data (invariant 8): kinds are rows, not code. Data-only;
-- idempotent (ON CONFLICT DO NOTHING). No per-tenant instance data is written
-- by this migration — every tenant starts unset (pure repo fallback) and an
-- admin opts in from Settings → Assistant.
--
-- Ids: fresh 0x2170 sub-band — attribute 1011-...-002170, action
-- 1013-...-002170 — verified free against every migrations_vertical file up to
-- and including 0179 (the highest prior 1011-...-002xxx id is 0179's 0x2160;
-- the highest prior 1013-...-002xxx id is 0170's 0x2210). ON CONFLICT (id) DO
-- NOTHING.
--
-- Multi-tenant: same 0113/0115 idiom — tenant-zero gets the fixed ids below;
-- every OTHER tenant that already has firm_settings gets the catch-up loop
-- (gen_random_uuid, idempotent by NOT EXISTS). Tenants created AFTER this
-- migration inherit the kinds from the tenant-zero registry clone.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kind on firm_settings (the Contract-K singleton) ────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000002170', '00000000-0000-0000-0000-000000000001',
   'email_drafting_config', 'Email drafting config',
   'The firm''s per-tenant override of the AI email-drafting prompt and/or house-voice doctrine: {prompt_version, prompt_text: string|null, house_voice_text: string|null}. Either half null falls back to the bundled repo template (templates/email-drafting-prompt.md / templates/house-voice.md). A new write supersedes the prior config append-only.',
   '00000000-0000-0000-1010-000000000501', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── action kind: set the config ───────────────────────────────────────────────
-- 'notify' / 'reversible_with_state_decay' mirror the other firm_settings
-- actions (legal.firm.set_default_rate, legal.firm.set_invoice_template,
-- legal.firm.set_manual_payment_methods).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000002170', '00000000-0000-0000-0000-000000000001',
   'legal.firm.set_email_drafting_config', 'Set email drafting config',
   'Record the firm''s email-drafting prompt and/or house-voice doctrine overrides (the email_drafting_config JSON attribute on the firm_settings singleton). The AI email drafting worker and the attorney "Draft with AI" compose box use the new config immediately; a new write supersedes the prior config.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
-- Kinds are strictly per-tenant (mirrors 0115's "seed for every firm" section):
-- resolve each tenant's OWN firm_settings entity kind by name (cloned tenants get
-- remapped ids), fresh random kind ids, idempotent via NOT EXISTS. Tenants created
-- AFTER this migration inherit the kinds from the tenant-zero registry clone.
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), fs.tenant_id, 'email_drafting_config', 'Email drafting config',
       'The firm''s per-tenant override of the AI email-drafting prompt and/or house-voice doctrine. Either half null falls back to the bundled repo template.',
       fs.id, 'json', false
FROM entity_kind_definition fs
WHERE fs.kind_name = 'firm_settings'
  AND fs.status = 'active'
  AND fs.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = fs.tenant_id AND a.kind_name = 'email_drafting_config'
  );

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'legal.firm.set_email_drafting_config', 'Set email drafting config',
       'Record the firm''s email-drafting prompt and/or house-voice doctrine overrides on the firm_settings singleton.',
       'notify', 'reversible_with_state_decay', NULL, false
FROM (
  SELECT DISTINCT tenant_id
  FROM entity_kind_definition
  WHERE kind_name = 'firm_settings' AND status = 'active'
    AND tenant_id <> '00000000-0000-0000-0000-000000000001'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'legal.firm.set_email_drafting_config'
);
