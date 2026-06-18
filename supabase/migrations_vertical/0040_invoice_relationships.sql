-- =============================================================================
-- Vertical migration 0040: invoice relationships (Billing, Session 4)
--
-- Two entity↔entity relationships, the substrate-native parent pointers (same
-- shape as matter_of / contact_of in migration 0020):
--   invoice_of  — an invoice belongs to a client   (invoice → client)
--   line_of     — a line belongs to its invoice     (invoice_line → invoice)
--
-- The third link the prompt names, billed_on (line → the billed time/expense
-- ENTRY), is NOT a relationship: the entry is an EVENT, not an entity, and
-- relationships connect entities. It lives as the line_source_event_id attribute
-- (migration 0039).
--
-- Session-4 id block ...-0000000004xx (see 0039 header). Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000401', '00000000-0000-0000-0000-000000000001',
   'invoice_of', 'Invoice of', 'An invoice bills a client (the invoice points at its client).',
   '00000000-0000-0000-1010-000000000401', '00000000-0000-0000-1010-000000000007', 'many_to_one', 'directed', 'has_invoice'),
  ('00000000-0000-0000-1012-000000000402', '00000000-0000-0000-0000-000000000001',
   'line_of', 'Line of', 'An invoice line belongs to its invoice (the line points at its invoice).',
   '00000000-0000-0000-1010-000000000402', '00000000-0000-0000-1010-000000000401', 'many_to_one', 'directed', 'has_line')
ON CONFLICT (id) DO NOTHING;
