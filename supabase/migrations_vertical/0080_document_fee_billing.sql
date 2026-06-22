-- =============================================================================
-- Vertical migration 0080: document-fee billing + manual fee / service completion
--
-- Beta feedback + founder direction: a matter/client should accrue billable fees
-- in TWO ways, separately and with multiplicity:
--   • a DOCUMENT fee when a document is completed (approved) — accrues to the
--     matter (and rolls up to the client); a matter can produce several documents,
--     so several document fees; and
--   • a SERVICE fee when the service workflow is marked complete — accrues to the
--     matter/client.
-- Both are flat fees configured on the service (config-as-data in the service's
-- workflow_definition.transitions: document_fees[doc_kind] and the existing
-- cost{type:'fixed'}); no schema change to set them. The attorney can also add a
-- fee by hand and void an unbilled one — multiplicity comes from multiple fee
-- LEDGER ENTRIES, not from re-modelling a matter to hold many services.
--
-- This migration adds, as definition ROWS (schema-as-data), only the kinds the
-- new flows need. It mirrors the time/expense/service-fee ledger pairs
-- (migrations 0018, 0041, 0071):
--
-- Event kinds (billing block 1014-…04xx; 0401..0408 taken → 0409..040b):
--   • document_fee.recorded — a document's flat fee, accrued billable when that
--     document is approved (observational; not a state change). Payload:
--     { service_key, document_kind, amount (decimal string), description }.
--     primary_entity_id = matter. Unbilled until a document_fee.billed names it.
--   • document_fee.billed    — marks a document_fee.recorded billed onto an invoice
--     line (state change). Payload: { source_event_id, invoice_id,
--     invoice_line_id, amount } — same shape as time.billed / expense.billed, so
--     listUnbilled's derivation and invoice.issue's marker extend cleanly.
--   • billing_entry.voided   — voids an unbilled ledger entry (a manually-added
--     fee the attorney removes, or an edit = void + re-add). Payload:
--     { source_event_id }. listUnbilled excludes any entry whose id it names, the
--     same way a *.billed event removes one from the unbilled feed.
--
-- Action kinds (action family 1013-…04xx; 0401/0402 taken → 0403..0405):
--   • legal.matter.add_fee     — add a service or document fee to a matter by hand.
--   • legal.matter.void_fee    — void an unbilled fee on a matter.
--   • legal.service.complete   — mark a matter's service workflow complete, which
--                                accrues the service's flat fee (if set).
--
-- Configuration-as-data; append-only events; no schema change; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000409', '00000000-0000-0000-0000-000000000001',
   'document_fee.recorded', 'Document fee recorded',
   'A document''s flat fee, accrued as billable when the document is approved. Payload: service_key, document_kind, amount (decimal string), description. primary_entity_id is the matter. Unbilled until a document_fee.billed event names it.',
   false),
  ('00000000-0000-0000-1014-00000000040a', '00000000-0000-0000-0000-000000000001',
   'document_fee.billed', 'Document fee billed',
   'Marks a document_fee.recorded entry billed onto an invoice line. Payload: source_event_id (the document_fee.recorded event), invoice_id, invoice_line_id, amount. Same shape as time.billed / expense.billed / service_fee.billed.',
   true),
  ('00000000-0000-0000-1014-00000000040b', '00000000-0000-0000-0000-000000000001',
   'billing_entry.voided', 'Billing entry voided',
   'Voids an unbilled ledger entry (a manually-added fee removed by the attorney, or the first half of an edit = void + re-add). Payload: source_event_id (the voided ledger event). The unbilled feed excludes any entry this names, like a *.billed event does.',
   true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000403', '00000000-0000-0000-0000-000000000001',
   'legal.matter.add_fee', 'Add fee to matter',
   'Add a service or document fee to a matter by hand (records a service_fee.recorded or document_fee.recorded ledger entry with human provenance). Reversible by voiding the entry before it is billed.',
   'notify', 'reversible_with_state_decay', 'legal.matter.void_fee', false),
  ('00000000-0000-0000-1013-000000000404', '00000000-0000-0000-0000-000000000001',
   'legal.matter.void_fee', 'Void matter fee',
   'Void an unbilled fee on a matter (records billing_entry.voided naming the fee''s ledger event). Reversible by adding the fee again.',
   'notify', 'fully_reversible', 'legal.matter.add_fee', false),
  ('00000000-0000-0000-1013-000000000405', '00000000-0000-0000-0000-000000000001',
   'legal.service.complete', 'Complete service',
   'Mark a matter''s service workflow complete, accruing the service''s flat fee (service_fee.recorded) if one is configured. Idempotent per matter + service.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
