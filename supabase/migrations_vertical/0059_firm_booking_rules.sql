-- =============================================================================
-- Vertical migration 0059: Contract L — firm booking rules (S5 booking).
--
-- Firm booking rules are the configurable constraints the public availability
-- engine slices slots against: bookable days/hours, buffer between calls,
-- minimum lead time, slot granularity, and default consultation length.
--
-- Storage is config-as-data (invariant 12), and reuses the already-on-main
-- versioned-config mechanism rather than a bespoke table: a SINGLETON
-- workflow_definition row per tenant (kind_name 'firm.booking_rules') carries
-- the rules under `transitions`, written through legal.booking_rules.update
-- (seal-and-insert + a configuration_change audit row, exactly like a service
-- edit). The row is excluded from the service lists by its reserved kind_name,
-- so it never surfaces as a bookable service. No firm.booking_rules row is
-- seeded here: reads default to the prior hardcoded behavior (Mon–Fri 9–5 ET,
-- 30-min slots) until the firm saves rules, at which point the handler writes
-- version 1.
--
-- This migration is therefore data-only and additive: the single action kind.
-- Idempotent (ON CONFLICT DO NOTHING). Lease 0059-0061; uses 0059 only.
--
-- Why workflow_definition and not the firm_settings entity (Contract K's home
-- for the firm default rate): this worker ships independently of that in-flight
-- work and depends only on what is already merged. Consolidating firm config
-- onto firm_settings is a clean follow-up once Contract K lands.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── action kind: legal.booking_rules.update ──────────────────────────────────
-- Saving the rules supersedes the prior version with a new active
-- workflow_definition row; the prior version stays in history (sealed by
-- valid_to). 'autonomous'/'reversible_with_state_decay' mirror the other
-- config-edit action kinds (legal.service.upsert).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000591', '00000000-0000-0000-0000-000000000001',
   'legal.booking_rules.update', 'Update firm booking rules',
   'Set (or change) the firm booking rules (Contract L) on the singleton firm.booking_rules workflow_definition. A new version supersedes the prior; history is preserved and audited via configuration_change.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
