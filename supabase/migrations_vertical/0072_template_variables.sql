-- =============================================================================
-- Vertical migration 0072: Typed template variables (template builder)
--
-- Each {{token}} in a standalone template can carry typed metadata — its type
-- (text / textarea / date / number / currency / boolean / choice), a required
-- flag, an optional default, and (for choice) options. Per ADR 0012
-- (schema-as-data) this is stored as a SINGLE structured attribute on the
-- template entity — NOT new tables/enums, and NOT one attribute-kind per field.
-- It mirrors questionnaire_responses (0003) and questionnaire_template_schema
-- (0068), both value_type 'json'.
--
-- Shape (object keyed by lowercased token id):
--   {
--     "client_name":    { "type": "text",     "required": true },
--     "effective_date": { "type": "date",     "default": "today" },
--     "plan_tier":      { "type": "choice",   "options": ["Standard", "Premium"] },
--     "retainer":       { "type": "currency", "required": true }
--   }
--
-- Writes flow through the existing legal.template.create / legal.template.update
-- handlers (one more attribute write) — no new action kind is needed. Reads come
-- back via the templates query layer alongside the body.
--
-- Migration number 0072 and attribute id 48 verified free against BOTH origin/main
-- (last vertical migration 0071) and the live pilot DB (private.vertical_migration
-- max 0071; attribute_kind_definition id …048 unused). Configuration-as-data;
-- idempotent (ON CONFLICT DO NOTHING).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000048', '00000000-0000-0000-0000-000000000001',
   'template_variables', 'Template variables',
   'Typed metadata for each {{token}} in the template body (type, required, default, choice options), keyed by token id. Structured JSON — see migration 0072.',
   '00000000-0000-0000-1010-000000000008', 'json', false)
ON CONFLICT (id) DO NOTHING;
