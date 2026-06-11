-- =============================================================================
-- Vertical migration 0003: questionnaire payload attribute kind (Phase 0, WP2)
--
-- The submitted intake answers live as a structured attribute on the
-- questionnaire_response entity (provenance + knowability per invariants 5/6),
-- not in entity metadata. Data-only; idempotent. Marked PII — intake responses
-- carry personal details.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000022', '00000000-0000-0000-0000-000000000001',
   'questionnaire_responses', 'Questionnaire responses',
   'The submitted intake answers (structured, keyed by form field id).',
   '00000000-0000-0000-1010-000000000003', 'json', true)
ON CONFLICT (id) DO NOTHING;
