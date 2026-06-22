-- =============================================================================
-- Vertical migration 0080: document-upload kinds (matter Documents tab)
--
-- Attorneys can upload externally-produced files (a signed PDF, an exhibit, a
-- client's document) to a matter. The bytes live in a PRIVATE Supabase Storage
-- bucket (`matter-documents`); the substrate records a first-class document the
-- normal way — a content_blob whose `body` holds the STORAGE OBJECT KEY (a
-- pointer, not the bytes), a document_version (status 'approved' — an upload is
-- not an AI draft to review), and a `document_of` relationship to the matter.
--
-- Uploads ride a DISTINCT `document_of` relationship (NOT `draft_of`) so they are
-- structurally separate from AI/template drafts: they can never pollute the
-- "latest draft" lane (latestDraftVersionId) or the pending-review lists, with no
-- query exclusions to maintain.
--
-- Schema-as-data ROWS only; idempotent (fixed ids + ON CONFLICT DO NOTHING). No
-- substrate-table ALTER: document_version.status keeps its existing CHECK set (we
-- use 'approved'); the `document_source` attribute marks upload provenance. Ids
-- verified free on prod (action 1013-…704, event 1014-…409, entity 1010-…704,
-- attribute 1011-…707, relationship 1012-…603) before authoring.
-- =============================================================================

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000704', '00000000-0000-0000-0000-000000000001',
   'document.upload', 'Upload document',
   'An attorney uploaded an external file to a matter; the bytes live in Supabase Storage and the substrate records the document + its object key.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000704', '00000000-0000-0000-0000-000000000001',
   'document_uploaded', 'Uploaded document',
   'An externally-produced file uploaded to a matter (bytes in Storage, pointer in content_blob).',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000707', '00000000-0000-0000-0000-000000000001',
   'document_source', 'Document source',
   'How a document was produced: uploaded | ai_draft | template_merge.',
   '00000000-0000-0000-1010-000000000704', 'text', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000603', '00000000-0000-0000-0000-000000000001',
   'document_of', 'Document of',
   'An uploaded document belongs to a matter (distinct from draft_of so uploads and AI drafts stay in separate lanes).',
   '00000000-0000-0000-1010-000000000704', '00000000-0000-0000-1010-000000000001',
   'many_to_many', 'directed', 'has_document')
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000409', '00000000-0000-0000-0000-000000000001',
   'document.uploaded', 'Document uploaded',
   'An attorney uploaded a document to a matter; payload holds filename, content_type, size, object_key, document_version_id.',
   false)
ON CONFLICT (id) DO NOTHING;
