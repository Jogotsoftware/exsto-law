-- =============================================================================
-- Vertical migration 0195: firm AI Context settings (CONTEXT-SETTINGS-1)
--
-- APPLIED WITH THE MERGE. Unlike 0180, this one is NOT safe to defer: the
-- Context Settings page's save path and the assistant's save_ai_instruction
-- tool both call legal.firm.set_ai_context_config on a REQUIRED write path, and
-- lookupKindId throws in production for a kind that does not exist. Reads
-- degrade safely either way (no attribute row can exist without the kind, so
-- getAiContextConfig resolves to the platform defaults), but a save would fail
-- loudly, so this is applied at merge time.
--
-- WHAT IT ADDS AND WHY. Document GENERATION and document REVIEW were the two AI
-- capabilities with no firm-level instruction layer. That is why the universal
-- drafting rules ("never invent a value, leave the {{token}} in place", "never
-- write draft banners into the document", "output the final document only")
-- ended up pasted into the FIRST PARAGRAPH of every service's drafting prompt
-- by defaultDraftingPrompt (api/templateAuthoring.ts) — platform rules sitting
-- inside the textarea an attorney edits for service-specific instruction, where
-- they could be reworded or deleted by accident. Those rules now live in code
-- (templates/promptDefaults.ts) and are composed in at generation time; this
-- migration gives the firm the place to put ITS defaults, plus its persistent
-- context file.
--
-- The sibling stores this deliberately does NOT duplicate (all pre-existing):
--   • firm-wide assistant instructions → firm_profile.assistant_instructions
--   • per-attorney instructions + the USER-level context file → that actor's
--     assistant_settings payload (a JSON blob, so contextMd needed no kind)
--   • email prompt + house voice     → firm_settings.email_drafting_config (0180)
--
-- Adds:
--   • attribute kind  ai_context_config (json, on firm_settings)
--       { version: number,
--         document_generation: { instructions: string[], base_guidance: string|null },
--         document_review:     { instructions: string[], base_guidance: string|null },
--         firm_context_md: string | null }
--     base_guidance null = use the platform's built-in universal rules (the
--     normal case). A new write supersedes the prior config append-only
--     (effective-dated), so the attribute history IS the audit trail of what
--     the firm told its AI and when.
--   • action kind     legal.firm.set_ai_context_config
--     Written through api/aiContextConfig.ts (updateAiContextConfig), which
--     normalizes and caps the payload and bumps `version` before submitting;
--     the handler (handlers/firmSettings.ts) stores it verbatim — same
--     discipline as legal.firm.set_email_drafting_config /
--     legal.firm.set_invoice_template.
--
-- Configuration-as-data (invariant 8): kinds are rows, not code. Data-only;
-- idempotent (ON CONFLICT DO NOTHING). No per-tenant instance data is written —
-- every tenant starts unset (pure platform defaults) and an admin opts in from
-- Settings → AI Context.
--
-- Ids: fresh 0x3600 sub-band — attribute 1011-...-003600, action
-- 1013-...-003600 — verified free against every migrations_vertical file
-- through 0194 (highest prior 1011-...-0000003xxx is 0x3502; highest prior
-- 1013-...-0000003xxx is 0x3400) AND against the live production registry.
-- ON CONFLICT (id) DO NOTHING.
--
-- Multi-tenant: same 0180 idiom — tenant-zero gets the fixed ids below; every
-- OTHER tenant that already has firm_settings gets the catch-up loop
-- (gen_random_uuid, idempotent by NOT EXISTS). Tenants created AFTER this
-- migration inherit the kinds from the tenant-zero registry clone.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kind on firm_settings (the Contract-K singleton) ────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000003600', '00000000-0000-0000-0000-000000000001',
   'ai_context_config', 'AI context config',
   'The firm''s AI Context settings: per-capability standing instructions and optional base-guidance overrides for document generation and document review, plus the firm''s persistent context file. Shape: {version, document_generation:{instructions:string[], base_guidance:string|null}, document_review:{...}, firm_context_md:string|null}. base_guidance null falls back to the platform''s built-in universal rules (verticals/legal/src/templates/promptDefaults.ts). A new write supersedes the prior config append-only.',
   '00000000-0000-0000-1010-000000000501', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── action kind: set the config ───────────────────────────────────────────────
-- 'notify' / 'reversible_with_state_decay' mirror the other firm_settings
-- actions (legal.firm.set_email_drafting_config, legal.firm.set_invoice_template,
-- legal.firm.set_manual_payment_methods).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000003600', '00000000-0000-0000-0000-000000000001',
   'legal.firm.set_ai_context_config', 'Set AI context config',
   'Record the firm''s AI Context settings (the ai_context_config JSON attribute on the firm_settings singleton): standing instructions per AI capability, optional universal-rule overrides, and the firm''s persistent context file. Every AI document generation and document review picks up the new config immediately; a new write supersedes the prior config.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
-- Kinds are strictly per-tenant: resolve each tenant's OWN firm_settings entity
-- kind by name (cloned tenants get remapped ids), fresh random kind ids,
-- idempotent via NOT EXISTS.
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), fs.tenant_id, 'ai_context_config', 'AI context config',
       'The firm''s AI Context settings: per-capability standing instructions and base-guidance overrides for document generation and review, plus the firm''s persistent context file.',
       fs.id, 'json', false
FROM entity_kind_definition fs
WHERE fs.kind_name = 'firm_settings'
  AND fs.status = 'active'
  AND fs.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = fs.tenant_id AND a.kind_name = 'ai_context_config'
  );

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'legal.firm.set_ai_context_config', 'Set AI context config',
       'Record the firm''s AI Context settings on the firm_settings singleton.',
       'notify', 'reversible_with_state_decay', NULL, false
FROM (
  SELECT DISTINCT tenant_id
  FROM entity_kind_definition
  WHERE kind_name = 'firm_settings' AND status = 'active'
    AND tenant_id <> '00000000-0000-0000-0000-000000000001'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'legal.firm.set_ai_context_config'
);
