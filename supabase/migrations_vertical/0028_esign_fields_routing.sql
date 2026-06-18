-- =============================================================================
-- Vertical migration 0028: E-signature fields, routing order, and status
--
-- Extends the native e-sign lifecycle (0027) toward a DocuSign-style flow, still
-- config-as-data (no schema change). Adds:
--   • signature fields as anchor tags (esign/fields.ts) — the parsed field plan
--     is stored on the envelope (envelope_fields); each signer's filled values on
--     their request (field_values).
--   • per-signer routing + identity: signer_key (matches field tags), signer_title,
--     signer_order (sequential routing), signer_channel ('portal' | 'link').
--   • richer per-signer status (delivered → opened → signed) via two new events
--     (esign.delivered, esign.opened) and the esign.open action that records a
--     signer viewing their document.
--
-- Signing surface: clients sign in the AUTHENTICATED portal (signer_channel
-- 'portal'); non-portal signers get the emailed secure link ('link'). Both record
-- the same esign.sign action.
--
-- Ids continue the e-block. Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── per-signer routing/identity + field values; envelope field plan ───────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-0000000000ec', '00000000-0000-0000-0000-000000000001',
   'signer_key', 'Signer key',
   'Stable key matching this signer to their field tags ({{type:key}}), e.g. client, manager.',
   '00000000-0000-0000-1010-0000000000e2', 'text', false),
  ('00000000-0000-0000-1011-0000000000ed', '00000000-0000-0000-0000-000000000001',
   'signer_title', 'Signer title', 'The signer''s title/role on the document (e.g. Member, Manager).',
   '00000000-0000-0000-1010-0000000000e2', 'text', false),
  ('00000000-0000-0000-1011-0000000000ee', '00000000-0000-0000-0000-000000000001',
   'signer_order', 'Signing order', 'Sequential routing order (1-based); same number = parallel within a step.',
   '00000000-0000-0000-1010-0000000000e2', 'number', false),
  ('00000000-0000-0000-1011-0000000000ef', '00000000-0000-0000-0000-000000000001',
   'signer_channel', 'Signing channel', 'How this signer signs: portal (authenticated client) | link (emailed secure link).',
   '00000000-0000-0000-1010-0000000000e2', 'text', false),
  ('00000000-0000-0000-1011-0000000000f0', '00000000-0000-0000-0000-000000000001',
   'field_values', 'Field values', 'The values this signer entered for their fields (JSON by field id).',
   '00000000-0000-0000-1010-0000000000e2', 'json', true),
  ('00000000-0000-0000-1011-0000000000f1', '00000000-0000-0000-0000-000000000001',
   'envelope_fields', 'Envelope fields', 'The parsed field plan for the document (JSON list of {id,type,signerKey}).',
   '00000000-0000-0000-1010-0000000000e1', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── esign.open: a signer viewed their document (delivered → opened) ───────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-0000000000e5', '00000000-0000-0000-0000-000000000001',
   'esign.open', 'Open signing document',
   'Record that a signer opened their document (status delivered → opened).',
   'autonomous', 'irreversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── delivered/opened lifecycle events ─────────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-0000000000e5', '00000000-0000-0000-0000-000000000001',
   'esign.delivered', 'Signing link delivered', 'A signer''s request was delivered (it became their turn to sign).', true),
  ('00000000-0000-0000-1014-0000000000e6', '00000000-0000-0000-0000-000000000001',
   'esign.opened', 'Signing document opened', 'A signer opened their document.', true)
ON CONFLICT (id) DO NOTHING;

-- ── notification route: portal signers (sign in to the portal to sign) ────────
-- Companion to esign_sign_request (0027, the emailed secure link for non-portal
-- signers). Portal signers get a "sign in to sign" nudge linking to the portal.
INSERT INTO notification_route_definition
  (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config) VALUES
  ('00000000-0000-0000-1030-000000000009', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'esign_sign_request_portal', 'E-sign: portal signing nudge',
   'email', '{"role":"client"}'::jsonb, 'esign-sign-request-portal', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
