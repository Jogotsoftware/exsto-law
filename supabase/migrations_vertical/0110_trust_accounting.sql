-- =============================================================================
-- Vertical migration 0110: trust (IOLTA) accounting — per-client ledger kinds
--
-- A law firm holds client funds (retainers/advances) in a POOLED trust account
-- (IOLTA), accounted for with a SEPARATE sub-ledger per client (NC State Bar
-- minimum). A client's trust balance is DERIVED from the append-only entries
-- below — never stored, never mutated — exactly like the time/expense/fee ledger
-- (migrations 0018/0041/0071/0080). Corrections are reversing entries, not edits
-- (ADR 0039; hard rule 3).
--
-- Each entry is primary_entity = the CLIENT (the ledger is per-client; matter is
-- a tag in the payload). Balance = deposits − disbursements − earned transfers
-- − refunds for that client. Compliance guardrails live in the handlers
-- (verticals/legal/src/handlers/trust.ts): a client's trust balance can never go
-- negative (overdraft is an ethics violation), and trust never commingles with
-- operating except through an explicit EARNED transfer against an issued invoice.
--
-- Money IN (a Plaid/Stripe payment, or a recorded check) lands here as
-- trust.deposited; collecting an earned, issued invoice from trust is
-- trust.transferred_earned, which also pays the invoice via invoice.pay
-- (method='trust') — reusing the invoice-payment seam from migration 0090.
--
-- Events: family ...1014, 04xx block (max was ...40d invoice.paid) -> 40e..411.
-- Actions: family ...1013, 04xx block (max was ...406 invoice.pay) -> 407..40a.
-- No new entity/attribute kinds — balances are derived from these events.
-- Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-00000000040e', '00000000-0000-0000-0000-000000000001',
   'trust.deposited', 'Trust deposit',
   'Client funds deposited into the firm trust (IOLTA) account, on the client''s sub-ledger. Primary=client; payload holds amount, currency, source (retainer|advance|settlement|other), matter_id (optional tag), reference, deposited_date.',
   true),
  ('00000000-0000-0000-1014-00000000040f', '00000000-0000-0000-0000-000000000001',
   'trust.disbursed', 'Trust disbursement',
   'Funds disbursed out of a client''s trust sub-ledger (e.g. paying a third party on the client''s behalf, or returning funds). Primary=client; payload holds amount, payee, reason, matter_id (optional), reference, disbursed_date.',
   true),
  ('00000000-0000-0000-1014-000000000410', '00000000-0000-0000-0000-000000000001',
   'trust.transferred_earned', 'Earned-fee transfer from trust',
   'Earned fees moved from a client''s trust sub-ledger to the operating account against an ISSUED invoice (attorney-initiated). Primary=client, secondary=[invoice]; payload holds amount, invoice_id, matter_id (optional). Pairs with invoice.paid (method=trust).',
   true),
  ('00000000-0000-0000-1014-000000000411', '00000000-0000-0000-0000-000000000001',
   'trust.refunded', 'Trust refund',
   'Unearned trust balance returned to the client. Primary=client; payload holds amount, reference, refunded_date.',
   true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000407', '00000000-0000-0000-0000-000000000001',
   'trust.deposit', 'Record trust deposit',
   'Record a deposit of client funds into trust (retainer/advance). Emits trust.deposited on the client''s sub-ledger. Reversible via a reversing entry; no in-place edit.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000408', '00000000-0000-0000-0000-000000000001',
   'trust.disburse', 'Disburse from trust',
   'Disburse funds from a client''s trust balance. Validates the client''s trust balance covers the amount (no overdraft); emits trust.disbursed.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000409', '00000000-0000-0000-0000-000000000001',
   'trust.transfer_earned', 'Apply trust to invoice (earned)',
   'Attorney-initiated: apply a client''s trust funds to an issued/sent invoice — move the billed amount trust→operating (trust.transferred_earned) and mark the invoice paid (invoice.pay, method=trust). Validates sufficient client trust balance and that the invoice is issued or sent.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-00000000040a', '00000000-0000-0000-0000-000000000001',
   'trust.refund', 'Refund trust balance',
   'Refund a client''s remaining (unearned) trust balance to the client. Validates the balance covers the refund; emits trust.refunded.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
