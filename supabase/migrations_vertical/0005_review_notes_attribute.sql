-- =============================================================================
-- Vertical migration 0005: review-notes attribute kind (Phase 0, WP4)
-- Data-only; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000026', '00000000-0000-0000-0000-000000000001',
   'document_review_notes', 'Review notes',
   'Attorney notes attached to a draft review decision.',
   '00000000-0000-0000-1010-000000000006', 'text', false)
ON CONFLICT (id) DO NOTHING;
