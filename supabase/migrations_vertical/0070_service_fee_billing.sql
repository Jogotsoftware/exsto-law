-- =============================================================================
-- Vertical migration 0070: service-fee billing event kinds
--
-- Beta feedback: the Unbilled list should include "documents approved", not just
-- logged hours and expenses. A fixed-fee service earns its fee when its work is
-- delivered, so when the FIRST document is approved for a matter (draft.approve)
-- the matter's fixed service fee accrues as a billable ledger entry — exactly like
-- a time.logged / expense.recorded entry — and is invoiced the same way. Hourly
-- services bill through logged time, so only a fixed fee accrues here.
--
-- Two new event kinds, mirroring the time/expense ledger pair (migrations 0018,
-- 0041):
--   • service_fee.recorded — the accrual (observational; not a state change),
--     payload { service_key, amount, description }, primary_entity_id = matter.
--   • service_fee.billed    — marks the accrual billed onto an invoice line
--     (a state change), payload { source_event_id, invoice_id, invoice_line_id,
--     amount } — the same shape as time.billed / expense.billed, so listUnbilled's
--     "not yet billed" derivation and invoice.issue's marker both extend cleanly.
--
-- Ids continue the billing block (1014-…0401..0404 = time/expense/invoice billed
-- + invoice issued/sent; …0405/0406 already taken by assistant.feedback_resolved
-- + notification.seen) at 0407/0408. Configuration-as-data; append-only events
-- (no schema change); idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000407', '00000000-0000-0000-0000-000000000001',
   'service_fee.recorded', 'Service fee recorded',
   'A matter''s fixed service fee, accrued as billable when its first document is approved. Payload: service_key, amount (decimal string), description. primary_entity_id is the matter. Unbilled until a service_fee.billed event names it.',
   false),
  ('00000000-0000-0000-1014-000000000408', '00000000-0000-0000-0000-000000000001',
   'service_fee.billed', 'Service fee billed',
   'Marks a service_fee.recorded entry billed onto an invoice line. Payload: source_event_id (the service_fee.recorded event), invoice_id, invoice_line_id, amount. Same shape as time.billed / expense.billed.',
   true)
ON CONFLICT (id) DO NOTHING;
