-- =============================================================================
-- Vertical migration 0053: firm email signature (fix #10) — config-as-data
--
-- Hardening-v3 S3 (email). Every outbound client email should carry the firm's
-- signature, applied ONCE in the central Contract B send path so manual sends,
-- booking confirmations (S5) and invoice emails (S7) all inherit it without each
-- reimplementing it. The signature must be attorney-EDITABLE, so it cannot be a
-- code literal — it is configuration, and configuration is data (hard rule 8).
--
-- The wedge-era `tenant_settings` table is uncertified and its writer is disabled
-- (Phase-1 library layer); firm config belongs in the substrate, not a bespoke
-- table. So the signature lives the substrate-native way: a per-tenant
-- `firm_profile` singleton entity carrying firm-wide config attributes. Today it
-- holds the email signature (text) + an enabled flag (boolean). The Phase-1 firm-
-- settings layer can extend the same entity with more attributes later.
--
-- "Tenant-scoped, per-user-capable": the firm_profile signature is the firm
-- default (tenant scope). A future per-attorney override is a matter of adding a
-- signature attribute on the actor/attorney entity and preferring it in the
-- resolver — the read path is written to allow that without a schema change.
--
-- DEFINITIONS ONLY. The firm_profile instance + its attribute values are created
-- THROUGH THE CORE by `legal.firm.signature_set` (handlers/firmSignature.ts),
-- never by raw SQL here (hard rules 1, 9). Idempotent (ON CONFLICT DO NOTHING).
--
-- Ids verified free against live pilot jfcarzprfpoztxuqykoe (entity ≤0x402,
-- attribute ≤0x417, action ≤0x402 in band; 0x500 sub-band is clear). Lease 0053.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── firm_profile entity kind (per-tenant singleton holding firm-wide config) ──
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000500', '00000000-0000-0000-0000-000000000001',
   'firm_profile', 'Firm profile',
   'Per-tenant singleton holding firm-wide configuration (e.g. the outbound email signature). One row per tenant; attributes supersede append-only.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── firm_profile config attributes ──────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000500', '00000000-0000-0000-0000-000000000001',
   'email_signature',         'Email signature',
   'Firm-wide signature appended to outbound client email in the central Contract B send path. Plain text; rendered into the text/plain and (when present) text/html parts.',
   '00000000-0000-0000-1010-000000000500', 'text',    false),
  ('00000000-0000-0000-1011-000000000501', '00000000-0000-0000-0000-000000000001',
   'email_signature_enabled', 'Email signature enabled',
   'When false, outbound client email carries no signature (the stored text is preserved, just not appended). When true the stored signature is used; when no signature has ever been saved the send path falls back to one derived from firm contact details.',
   '00000000-0000-0000-1010-000000000500', 'boolean', false)
ON CONFLICT (id) DO NOTHING;

-- ── Configuration action: set the firm email signature ───────────────────────
-- Writes flow through handlers/firmSignature.ts (lazily creates the singleton,
-- supersedes the attributes append-only). Reversible by setting it again — no
-- reverse action kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000500', '00000000-0000-0000-0000-000000000001',
   'legal.firm.signature_set', 'Set firm email signature',
   'Set or update the firm-wide outbound-email signature (text + enabled flag) on the firm_profile singleton.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
