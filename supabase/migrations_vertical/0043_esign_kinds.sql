-- =============================================================================
-- Vertical migration 0043: E-signature envelope lifecycle (Session 5)
--
-- Configuration-as-data (invariant 12 / 23): e-signature is composed from the
-- existing primitives — no schema change, no new tables.
--
-- NATIVE-FIRST (per the 2026-06-17 "rebuild within" decision): signing happens
-- in the substrate via a sign-by-link flow (no external host, no recurring
-- cost). OpenSign/DocuSign are flow references only; nothing is vendored. The
-- provider-agnostic EsignDriver seam (verticals/legal/src/esign) is retained so
-- an external provider COULD drop in later, but the default and the live path
-- are native. No provider name appears in any kind.
--
-- Concepts:
--   entity kinds        signature_envelope, signature_request
--   relationship kinds  envelope_of (envelope → document), request_of (→ envelope)
--   action kinds        esign.send           (send a document for signature)
--                       esign.sign           (a signer signs — native path)
--                       esign.decline        (a signer declines — native path)
--                       esign.record_status  (record an EXTERNAL provider callback;
--                                             dormant unless an external driver runs)
--   event kinds         esign.sent, esign.signed, esign.completed, esign.declined
--
-- Lifecycle: esign.send → envelope ('sent' once dispatched, else 'pending_dispatch')
-- → each signer opens a secure link and esign.sign / esign.decline drives
-- esign.signed → esign.completed (executed copy written as a NEW immutable
-- document_version, invariant 14, with the original content SHA-256 embedded as
-- tamper-evidence) or esign.declined.
--
-- Ids: e-block (…e1+) clears used decimal ranges. Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── entity kinds: envelope + per-signer request ──────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'signature_envelope', 'Signature envelope',
   'A request to execute a document via e-signature. Tracks lifecycle from sent through completed/declined.',
   NULL, true, false, true, false),
  ('00000000-0000-0000-1010-0000000000e2', '00000000-0000-0000-0000-000000000001',
   'signature_request', 'Signature request',
   'One signer''s slot within a signature envelope (their email, name, signing status, and signature).',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── envelope + signer attributes ─────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'envelope_status', 'Envelope status',
   'Lifecycle: pending_dispatch | sent | completed | declined.',
   '00000000-0000-0000-1010-0000000000e1', 'enum', false),
  ('00000000-0000-0000-1011-0000000000e2', '00000000-0000-0000-0000-000000000001',
   'esign_provider', 'E-sign provider',
   'Which engine handled this envelope (native by default). Internal; never shown as a brand to clients.',
   '00000000-0000-0000-1010-0000000000e1', 'text', false),
  ('00000000-0000-0000-1011-0000000000e3', '00000000-0000-0000-0000-000000000001',
   'provider_envelope_ref', 'Provider envelope ref',
   'An external provider''s id for the envelope, when an external driver is used. Null for native.',
   '00000000-0000-0000-1010-0000000000e1', 'text', false),
  ('00000000-0000-0000-1011-0000000000e4', '00000000-0000-0000-0000-000000000001',
   'envelope_subject', 'Envelope subject', 'Neutral subject/title shown to signers.',
   '00000000-0000-0000-1010-0000000000e1', 'text', false),
-- signature_request attributes
  ('00000000-0000-0000-1011-0000000000e5', '00000000-0000-0000-0000-000000000001',
   'signer_email', 'Signer email', 'Signer''s email address.',
   '00000000-0000-0000-1010-0000000000e2', 'text', true),
  ('00000000-0000-0000-1011-0000000000e6', '00000000-0000-0000-0000-000000000001',
   'signer_name', 'Signer name', 'Signer''s display name.',
   '00000000-0000-0000-1010-0000000000e2', 'text', true),
  ('00000000-0000-0000-1011-0000000000e7', '00000000-0000-0000-0000-000000000001',
   'signer_status', 'Signer status', 'Per-signer state: pending | signed | declined.',
   '00000000-0000-0000-1010-0000000000e2', 'enum', false),
  ('00000000-0000-0000-1011-0000000000e8', '00000000-0000-0000-0000-000000000001',
   'signer_provider_ref', 'Signer provider ref', 'An external provider''s id for this signer, when used.',
   '00000000-0000-0000-1010-0000000000e2', 'text', false),
  ('00000000-0000-0000-1011-0000000000e9', '00000000-0000-0000-0000-000000000001',
   'signed_at', 'Signed at', 'When the signer signed (native path).',
   '00000000-0000-0000-1010-0000000000e2', 'datetime', false),
  ('00000000-0000-0000-1011-0000000000ea', '00000000-0000-0000-0000-000000000001',
   'signer_consent', 'Signer consent', 'The consent statement the signer accepted (ESIGN/UETA intent-to-sign).',
   '00000000-0000-0000-1010-0000000000e2', 'text', false),
  ('00000000-0000-0000-1011-0000000000eb', '00000000-0000-0000-0000-000000000001',
   'signature_data', 'Signature', 'The signer''s adopted signature (typed name or drawn-image data URL).',
   '00000000-0000-0000-1010-0000000000e2', 'text', true)
ON CONFLICT (id) DO NOTHING;

-- ── relationships: envelope_of (→ document), request_of (→ envelope) ──────────
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'envelope_of', 'Envelope of',
   'A signature envelope executes a specific document (its versions live in document_version).',
   '00000000-0000-0000-1010-0000000000e1', '00000000-0000-0000-1010-000000000006',
   'many_to_one', 'directed', 'has_envelope'),
  ('00000000-0000-0000-1012-0000000000e2', '00000000-0000-0000-0000-000000000001',
   'request_of', 'Request of',
   'A signature request (one signer) belongs to a signature envelope.',
   '00000000-0000-0000-1010-0000000000e2', '00000000-0000-0000-1010-0000000000e1',
   'many_to_one', 'directed', 'has_request')
ON CONFLICT (id) DO NOTHING;

-- ── action kinds ─────────────────────────────────────────────────────────────
-- esign.send: attorney-initiated; emailing signing links has external effects →
-- reversible_with_external_caveats. esign.sign/esign.decline run as the public-
-- intake system actor (signer identity lives on the request, like the client
-- portal). esign.record_status: dormant external-callback path.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'esign.send', 'Send for signature',
   'Create a signature envelope for a document and send each signer a secure signing link.',
   'notify', 'reversible_with_external_caveats', NULL, false),
  ('00000000-0000-0000-1013-0000000000e2', '00000000-0000-0000-0000-000000000001',
   'esign.sign', 'Sign',
   'A signer adopts their signature on a request; on the last signer the envelope completes and the executed copy is written as a new document_version.',
   'autonomous', 'irreversible', NULL, false),
  ('00000000-0000-0000-1013-0000000000e3', '00000000-0000-0000-0000-000000000001',
   'esign.decline', 'Decline to sign',
   'A signer declines; the envelope is closed as declined.',
   'autonomous', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-0000000000e4', '00000000-0000-0000-0000-000000000001',
   'esign.record_status', 'Record signature status (external)',
   'Record a verified EXTERNAL provider callback. Dormant unless an external e-sign driver is configured.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── event kinds: the envelope lifecycle ──────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'esign.sent', 'Sent for signature', 'A signature envelope was created and signing links were sent.', true),
  ('00000000-0000-0000-1014-0000000000e2', '00000000-0000-0000-0000-000000000001',
   'esign.signed', 'Signer signed', 'A signer adopted their signature on a request within an envelope.', true),
  ('00000000-0000-0000-1014-0000000000e3', '00000000-0000-0000-0000-000000000001',
   'esign.completed', 'Envelope completed', 'All signers signed; the executed copy is recorded as a new document_version.', true),
  ('00000000-0000-0000-1014-0000000000e4', '00000000-0000-0000-0000-000000000001',
   'esign.declined', 'Envelope declined', 'A signer declined; the envelope is closed as declined.', true)
ON CONFLICT (id) DO NOTHING;

-- ── notification route: the signer's secure signing-link email ────────────────
-- Config-as-data, mirrors the client-portal magic-link route (0014). The API
-- always passes an explicit `to` (the signer's email); recipient-role is a backstop.
INSERT INTO notification_route_definition
  (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config) VALUES
  ('00000000-0000-0000-1030-000000000008', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'esign_sign_request', 'E-sign: signing link',
   'email', '{"role":"client"}'::jsonb, 'esign-sign-request', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
