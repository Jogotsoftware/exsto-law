-- =============================================================================
-- Vertical migration 0042: invoice action kinds (Billing, Session 4)
--
-- Invoices are STATEFUL entities with a lifecycle and side effects, so — unlike
-- time/expense logging (observational events through the generic event.record) —
-- they get dedicated action kinds with handlers (verticals/legal/src/handlers/
-- invoice.ts):
--
--   invoice.issue — create an invoice + its lines from selected unbilled time +
--                   expense events, mark each source entry billed (time.billed /
--                   expense.billed), emit invoice.issued. Reversible by decay (a
--                   future invoice.void seals it and un-bills its sources); no
--                   reverse handler in v1.
--   invoice.send  — send an issued invoice to the client and record invoice.sent.
--                   Sending an email is irreversible. v1 records the intent through
--                   the core and flags activation_gated (live Gmail delivery needs
--                   Google connect + the comms send contract from S3); see the
--                   handler's clearly-marked seam.
--
-- No payments and no IOLTA action kinds in v1 — both explicitly deferred.
--
-- Session-4 id block ...-0000000004xx (see 0039 header — action family ...1013,
-- natural max was ...0022). Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000401', '00000000-0000-0000-0000-000000000001',
   'invoice.issue', 'Issue invoice',
   'Roll selected unbilled time + expense events into a new invoice + lines, mark the sources billed, and issue it.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000402', '00000000-0000-0000-0000-000000000001',
   'invoice.send', 'Send invoice',
   'Send an issued invoice to the client and record invoice.sent. v1 live delivery is activation-gated (Google connect + comms send contract).',
   'notify', 'irreversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
