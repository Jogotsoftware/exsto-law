-- =============================================================================
-- Vertical migration 0004: call/transcript content attribute kinds (Phase 0, WP3)
-- Data-only; idempotent. Transcript text is PII (client conversation content).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000023', '00000000-0000-0000-0000-000000000001',
   'transcript_text', 'Transcript text',
   'Full consultation transcript text projected from the raw Granola payload.',
   '00000000-0000-0000-1010-000000000005', 'text', true),
  ('00000000-0000-0000-1011-000000000024', '00000000-0000-0000-0000-000000000001',
   'call_ended_at', 'Call ended at',
   'When the consultation call ended.',
   '00000000-0000-0000-1010-000000000004', 'datetime', false),
  ('00000000-0000-0000-1011-000000000025', '00000000-0000-0000-0000-000000000001',
   'call_notes', 'Call notes',
   'Granola structured AI notes for the call.',
   '00000000-0000-0000-1010-000000000004', 'json', true)
ON CONFLICT (id) DO NOTHING;
