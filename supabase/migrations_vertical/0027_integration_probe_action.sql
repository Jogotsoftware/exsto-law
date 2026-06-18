-- =============================================================================
-- Vertical migration 0027: integration connection probe action (Session 1)
--
-- The integration spine sets a connection to 'connected' ONLY after a real
-- capability probe passes (Google: a live Gmail profile read AND a Calendar
-- list; API keys: a live provider ping). This action kind makes each probe a
-- first-class, auditable transition through the operation core (CLAUDE.md hard
-- rule 1) instead of overloading config.change: a probe records provider +
-- outcome ('connected' | 'error') + a redacted detail, so "show every probe
-- failure for google" is a plain query over the action/event stream.
--
-- The connection row itself is an operational lifecycle table (migration 0002,
-- ADR 0039 analog): status + last_probe_at mutate in place via the Vault-backed
-- connectionStore (withSuperuser); this action is the audit event beside that
-- write, mirroring how connect/disconnect already record a config.change.
--
-- No new entity/attribute/relationship kinds. last_probe_at rides in the
-- existing `detail` jsonb (non-secret display metadata) — no DDL needed.
--
-- Next free action id verified against the live pilot DB: the legal block tops at
-- 00000000-0000-0000-1013-000000000029 (legal.meeting.reconcile); billing uses a
-- separate 1013-...04xx block. This claims ...02a. Configuration-as-data;
-- idempotent; additive.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-00000000002a', '00000000-0000-0000-0000-000000000001',
   'legal.integration.probe', 'Probe integration connection',
   'Record the result of a live capability probe for a provider connection (google/granola/anthropic/perplexity). Sets the connection connected only when the probe passes; otherwise records the error detail. The credential itself never appears in the payload.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
