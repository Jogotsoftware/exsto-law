-- =============================================================================
-- Vertical migration 0163: firm profile fields + attorney signature — config-as-data
--
-- BUILDER-UX-3 (P13 + P15).
--
-- P13: generated documents need firm identity (name/address/phone/email) as
-- SYSTEM merge slots, resolved by the platform — never asked of the client,
-- never forged from defaults. The wedge-era `tenant_settings` table's writer is
-- disabled (updateTenantSettings throws), so the Settings "Firm details" form
-- cannot persist today. These fields live the substrate-native way: attributes
-- on the existing per-tenant `firm_profile` singleton (0053), written through a
-- new `legal.firm.set_profile` action.
--
-- P15: the attorney's standing signature (typed / drawn / uploaded) that e-sign
-- steps apply. Attributes can only attach to entities (attribute.entity_id →
-- entity.id), never to actor rows, so the signature lives on a per-attorney
-- `attorney_profile` entity bound to its actor by an `profile_actor_id`
-- attribute — the exact client_contact↔portal_actor_id precedent. The existing
-- `signature_data` kind (0043) is per-envelope-signer adoption and is NOT
-- reused: lookupKindId resolves attribute kinds by kind_name, and its declared
-- binding/semantics are the signature_request.
--
-- DEFINITIONS ONLY. Instances + values are created THROUGH THE CORE by
-- handlers/firmSettings-style handlers, never raw SQL here (hard rules 1, 9).
-- Idempotent (ON CONFLICT DO NOTHING).
--
-- Ids: fresh 0x1900 sub-band, verified free against live pilot
-- jfcarzprfpoztxuqykoe across all four definition tables AND origin/main
-- (entity max 0a01, attribute max 1803, action max 1801). Lease 0163.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── P13: firm identity attributes on the firm_profile singleton (0053) ───────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000001900', '00000000-0000-0000-0000-000000000001',
   'firm_name',    'Firm name',
   'The firm''s display name as it appears on generated documents and client-facing pages. A SYSTEM merge slot — never routed into a client questionnaire.',
   '00000000-0000-0000-1010-000000000500', 'text', false),
  ('00000000-0000-0000-1011-000000001901', '00000000-0000-0000-0000-000000000001',
   'firm_address', 'Firm address',
   'The firm''s mailing address for document letterheads and signature blocks. A SYSTEM merge slot.',
   '00000000-0000-0000-1010-000000000500', 'text', false),
  ('00000000-0000-0000-1011-000000001902', '00000000-0000-0000-0000-000000000001',
   'firm_phone',   'Firm phone',
   'The firm''s phone number for document letterheads and client-facing copy. A SYSTEM merge slot.',
   '00000000-0000-0000-1010-000000000500', 'text', false),
  ('00000000-0000-0000-1011-000000001903', '00000000-0000-0000-0000-000000000001',
   'firm_email',   'Firm email',
   'The firm''s contact email for document letterheads and client-facing copy. A SYSTEM merge slot.',
   '00000000-0000-0000-1010-000000000500', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── P13: configuration action — set firm profile details ─────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000001900', '00000000-0000-0000-0000-000000000001',
   'legal.firm.set_profile', 'Set firm profile details',
   'Set or update the firm''s identity fields (name, address, phone, email) on the firm_profile singleton. Attributes supersede append-only.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── P15: per-attorney profile entity (actor-bound config home) ───────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000001900', '00000000-0000-0000-0000-000000000001',
   'attorney_profile', 'Attorney profile',
   'Per-attorney singleton holding attorney-scoped configuration (e.g. the standing e-signature). One per attorney actor, bound by the profile_actor_id attribute; attributes supersede append-only.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000001904', '00000000-0000-0000-0000-000000000001',
   'profile_actor_id', 'Profile actor id',
   'The actor this attorney_profile belongs to (attributes cannot attach to actor rows). Mirrors the client_contact/portal_actor_id binding precedent.',
   '00000000-0000-0000-1010-000000001900', 'text', false),
  ('00000000-0000-0000-1011-000000001905', '00000000-0000-0000-0000-000000000001',
   'attorney_signature', 'Attorney signature',
   'The attorney''s standing signature applied by e-sign steps: { mode: typed|drawn|uploaded, name: text, data: image data URL or null }. Size-capped at write; PII.',
   '00000000-0000-0000-1010-000000001900', 'json', true)
ON CONFLICT (id) DO NOTHING;

-- ── P15: configuration action — set the attorney signature ───────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000001901', '00000000-0000-0000-0000-000000000001',
   'legal.attorney.signature_set', 'Set attorney signature',
   'Set or update the signed-in attorney''s standing signature (typed, drawn, or uploaded) on their attorney_profile. Attributes supersede append-only.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
