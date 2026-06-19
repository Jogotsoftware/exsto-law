-- =============================================================================
-- Vertical migration 0065: Contract K — firm default billing rate (Session 7)
--
-- Contract K is the single source of truth for billing rates. Two of its three
-- scopes already have substrate-native homes and need NO new schema:
--   • per-client hourly  → client_billable_rate attribute on the client entity
--                           (migration 0020), written via legal.client.update.
--   • per-service fee     → fixed_fee key in a service's workflow_definition
--                           config, written via legal.service.upsert
--                           (transitions_patch). Services ARE workflow_definition
--                           rows, not entities, so the fee rides their version.
--
-- The ONLY missing home is the FIRM DEFAULT — the fallback rate used when a
-- client has no explicit rate. Today it lives on the wedge-era tenant_settings
-- table whose writer throws ("settings become substrate configuration, not a
-- bespoke table"). This migration gives it a substrate-native home so the firm
-- default is set, versioned, and resolved through the core like every other fact.
--
-- Modeled as a SINGLETON firm_settings entity (one per tenant) carrying a
-- firm_default_hourly_rate attribute. A singleton entity (not a kind/definition
-- row) is correct here because a default rate is a VALUE that changes over time,
-- not configuration schema — so it belongs in entity_attribute, where the
-- bitemporal substrate gives it effective-dating (latest valid_from wins) and
-- provenance for free. firm_settings is the natural home for future firm-level
-- settings too (Contract L's deep settings panel).
--
-- Money discipline (ADR 0044): firm_default_hourly_rate is value_type 'money' —
-- a DECIMAL STRING, never a JSON number.
--
-- Configuration-as-data (invariant 12): a new entity kind / attribute kind /
-- action kind is a row, not code. Data-only; idempotent (ON CONFLICT DO NOTHING).
--
-- Ids: …501 range (entity 1010, attribute 1011, action 1013) — a fresh range
-- past invoice (…401/402) and esign (…e1+). Lease 0065-0068; uses 0065 only.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── entity kind: firm_settings (singleton per tenant) ────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000501', '00000000-0000-0000-0000-000000000001',
   'firm_settings', 'Firm settings',
   'Singleton per tenant: firm-level configuration that is a value rather than schema. Currently holds the firm default billing rate (Contract K); future firm settings (Contract L) attach here.',
   NULL, false, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── attribute kind: firm_default_hourly_rate (money / decimal string) ─────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000501', '00000000-0000-0000-0000-000000000001',
   'firm_default_hourly_rate', 'Firm default hourly rate',
   'The firm-wide fallback hourly rate, a decimal string (ADR 0044). Contract K resolves a client''s rate to client_billable_rate, falling back to this when the client has none. Effective-dated by valid_from.',
   '00000000-0000-0000-1010-000000000501', 'money', false)
ON CONFLICT (id) DO NOTHING;

-- ── action kind: legal.firm.set_default_rate ─────────────────────────────────
-- Setting the firm default supersedes the prior value with a new attribute row
-- (append-only); the prior rate stays in history. 'notify'/'reversible_with_
-- state_decay' mirror the billing action kinds (invoice.issue).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000501', '00000000-0000-0000-0000-000000000001',
   'legal.firm.set_default_rate', 'Set firm default rate',
   'Set (or change) the firm default hourly rate on the singleton firm_settings entity. A new attribute row supersedes the prior value; history is preserved.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
