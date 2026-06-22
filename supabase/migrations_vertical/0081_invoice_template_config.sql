-- =============================================================================
-- Vertical migration 0081: invoice template config (branding) on firm_settings
--
-- Beta feedback: the attorney wants a customizable invoice — a real, branded PDF
-- the "view invoice" action shows and that attaches to the send email. The layout
-- is a fixed professional template; what the attorney customizes is the branding
-- and content: firm name/address/phone, a logo, an accent color, which columns
-- show, a header note, and footer / payment-instructions text. That config is one
-- JSON attribute on the singleton firm_settings entity (migration 0065) — schema
-- as data, no new table.
--
--   • attribute invoice_template_config (json) on firm_settings (…1010-…0501).
--     Block …1011-…05a* continues the firm attribute block (…05a1 = the default
--     rate); …05a2 verified free.
--   • action legal.firm.set_invoice_template — writes a new config (append-only,
--     effective-dated). Firm action block …1013-…05xx (0500 signature_set, 0501
--     set_default_rate); …0502 verified free.
--
-- Configuration-as-data; append-only; no schema change; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-0000000005a2', '00000000-0000-0000-0000-000000000001',
   'invoice_template_config', 'Invoice template config',
   'Branding + content config the invoice PDF renders from: firm name/address/phone, logo (base64 data URL), accent color, visible columns, header note, footer / payment-instructions text. A JSON object on the firm_settings singleton; effective-dated by valid_from.',
   '00000000-0000-0000-1010-000000000501', 'json', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000502', '00000000-0000-0000-0000-000000000001',
   'legal.firm.set_invoice_template', 'Set invoice template',
   'Save the firm''s invoice template branding/content config (writes a new invoice_template_config attribute on firm_settings; the prior config stays in history).',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
