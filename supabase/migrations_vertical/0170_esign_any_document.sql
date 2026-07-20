-- =============================================================================
-- Vertical migration 0170: E-sign any document (standalone PDF envelopes)
--
-- Configuration-as-data (invariant 12 / 23): sending an ARBITRARY uploaded PDF
-- for signature — decoupled from a matter or an AI draft, DocuSign-style — is
-- composed almost entirely from existing kinds. signature_envelope / esign.send
-- were always document-agnostic; the coupling to markdown drafts lived in code
-- paths, not the model. The only genuinely new concept is WHERE a matterless
-- document gets filed:
--
--   relationship kind  document_of_contact  (document_uploaded → client_contact)
--     A standalone upload can be attached to an existing contact instead of a
--     matter — the CRM filing lane for documents that precede (or never get) a
--     matter. Distinct from document_of (→ matter) for the same reason
--     document_of is distinct from draft_of: separate lanes, no polymorphic
--     target ambiguity in the matter-documents queries.
--
-- Everything else rides existing kinds unchanged:
--   • document.upload (0082) — handler now treats the matter as OPTIONAL.
--   • esign.send (0043)      — handler now auto-creates a client_contact for any
--                              signer email not already in contacts (same
--                              dedupe-by-email rule as intake.submit).
--
-- Id block 2100 (relationship 1012-...002100): verified FREE on origin/main
-- migration files (frontier 0169, which used block 2000) and picked above the
-- prod ledger frontier. Idempotent via ON CONFLICT (id) DO NOTHING. Seeds
-- tenant-zero (dev, 0001) per the established feature-migration convention;
-- cross-tenant kind provisioning rides the normal bootstrap/replay path.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── relationship kind: file a standalone upload under a contact ──────────────
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000002100', '00000000-0000-0000-0000-000000000001',
   'document_of_contact', 'Document of contact',
   'A standalone uploaded document filed under a client contact (no matter). The e-sign "attach to contact" lane; distinct from document_of (→ matter).',
   '00000000-0000-0000-1010-000000000704', '00000000-0000-0000-1010-000000000002',
   'many_to_many', 'directed', 'has_contact_document')
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
