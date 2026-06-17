-- =============================================================================
-- Vertical migration 0018: time.logged + expense.recorded event kinds
--
-- Every matter gets two ledgers an attorney maintains by hand: billable TIME
-- (duration + description) and EXPENSES (amount + description + optional
-- receipt). Both are observational journal entries on the matter timeline — they
-- don't transition matter state or lock anything — so they are event kinds
-- written through the generic event.record action (like research.recorded /
-- feedback.recorded / assistant.turn), not new action kinds with handlers.
--
-- These two ledgers are the data the billing module (next) will roll up into an
-- invoice: SUM(duration) × rate + SUM(expense amount).
--
-- Money discipline (ADR 0044): expense amounts are stored as DECIMAL STRINGS in
-- the event payload (never JSON numbers, which lose precision); totals are summed
-- with public.money_to_numeric. Duration is whole minutes (integer).
--
-- Configuration-as-data: a new event kind is a row, not code. Neither is a state
-- change. Data-only; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-00000000000d', '00000000-0000-0000-0000-000000000001',
   'time.logged', 'Time logged',
   'An attorney logged billable time against a matter; payload holds duration_minutes, description, and the worked date.',
   false),
  ('00000000-0000-0000-1014-00000000000e', '00000000-0000-0000-0000-000000000001',
   'expense.recorded', 'Expense recorded',
   'An attorney recorded a matter expense; payload holds amount (decimal string), currency, description, the incurred date, and optional receipt metadata + bytes.',
   false)
ON CONFLICT (id) DO NOTHING;
