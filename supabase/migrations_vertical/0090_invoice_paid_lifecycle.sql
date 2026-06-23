-- =============================================================================
-- Vertical migration 0090: invoice payment + paid lifecycle
--
-- Adds the last invoice lifecycle transition the matter timeline needs:
--   invoice.paid  (event)  — an invoice was paid in full; payload holds method,
--                            amount, currency, reference, paid_date. PRIMARY =
--                            invoice, SECONDARY = [client, matter(s)] so a
--                            matter-scoped timeline (getMatterHistory) sees it
--                            natively (invoice.issued/sent are being widened to
--                            carry the matter(s) too, in handlers/invoice.ts).
--   invoice.pay   (action) — record a payment against an issued/sent invoice:
--                            sets invoice_status='paid' and emits invoice.paid.
--
-- ONE shared action records payment whatever the source. The v1 caller is a
-- manual "Mark paid" (method='manual') from the attorney; a payment-processor
-- webhook (method='stripe', external reference) will later call the SAME action
-- — the clean seam, no rebuild.
--
-- invoice_status is value_type 'enum' with EMPTY validation (migration 0039), so
-- 'paid' is accepted with no ALTER — schema-as-data; the new value is documented
-- on the invoice.paid event kind below.
--
-- No new tables, no new attribute kinds: payment metadata lives in the append-
-- only invoice.paid event payload (ADR 0039). Reversibility:
-- reversible_with_state_decay (a future invoice.void_payment can reverse; no
-- reverse handler in v1).
--
-- Ids: event family ...1014 (04xx block; natural max was ...40c document.uploaded)
--      -> ...40d. Action family ...1013 (04xx block; max was ...405
--      legal.service.complete) -> ...406. Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-00000000040d', '00000000-0000-0000-0000-000000000001',
   'invoice.paid', 'Invoice paid',
   'An invoice was paid in full and moved to status=paid; payload holds method (manual | <processor>), amount, currency, reference, paid_date. Primary=invoice, secondary=[client, matter(s)].',
   true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000406', '00000000-0000-0000-0000-000000000001',
   'invoice.pay', 'Record invoice payment',
   'Record a payment against an issued/sent invoice: set invoice_status=paid and emit invoice.paid. Called by a manual "Mark paid" today and by a payment-processor webhook later (the same action).',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
