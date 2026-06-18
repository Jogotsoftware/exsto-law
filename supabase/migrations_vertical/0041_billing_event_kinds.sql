-- =============================================================================
-- Vertical migration 0041: billing event kinds (Billing, Session 4)
--
-- Billed status is a TRANSITION recorded as an EVENT, never an in-place mutation
-- of the original ledger entry (ADR 0039; hard rule 3 — event/journal rows are
-- append-only). So "this time/expense entry is now billed" is a new event that
-- REFERENCES the original entry's event id, not an UPDATE of it.
--
--   time.billed     — a time.logged event was billed onto an invoice line.
--   expense.billed  — an expense.recorded event was billed onto an invoice line.
--                     payload: { source_event_id, invoice_id, invoice_line_id, amount }
--
--   invoice.issued  — an invoice moved draft → issued.
--   invoice.sent    — an invoice was sent to the client (or queued; v1 live send
--                     is activation-gated — payload carries activation_gated +
--                     delivered flags).
--
-- "Unbilled" is therefore a derived set: time.logged / expense.recorded events
-- whose id does NOT appear as a source_event_id in any *.billed event.
--
-- All four are state-change events. Session-4 id block ...-0000000004xx (see 0039
-- header — event family ...1014, natural max was ...000e). Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000401', '00000000-0000-0000-0000-000000000001',
   'time.billed', 'Time billed',
   'A logged time entry (time.logged event) was billed onto an invoice line; payload holds source_event_id, invoice_id, invoice_line_id, amount.',
   true),
  ('00000000-0000-0000-1014-000000000402', '00000000-0000-0000-0000-000000000001',
   'expense.billed', 'Expense billed',
   'A recorded expense (expense.recorded event) was billed onto an invoice line; payload holds source_event_id, invoice_id, invoice_line_id, amount.',
   true),
  ('00000000-0000-0000-1014-000000000403', '00000000-0000-0000-0000-000000000001',
   'invoice.issued', 'Invoice issued',
   'An invoice transitioned draft → issued; payload holds total, currency, line_count.',
   true),
  ('00000000-0000-0000-1014-000000000404', '00000000-0000-0000-0000-000000000001',
   'invoice.sent', 'Invoice sent',
   'An invoice was sent to the client; payload holds to, channel, activation_gated, delivered. v1 live delivery is activation-gated on Google connect + the comms send contract.',
   true)
ON CONFLICT (id) DO NOTHING;
