-- =============================================================================
-- 0165 — HOTFIX-P17 (completion integrity): the legal.fee.waive action kind and
-- the fee.waived event kind.
--
-- A waive is the firm's DELIBERATE, RECORDED decision to forgo a fee it is owed —
-- with a mandatory reasoning trace (requires_reasoning_trace = true). It is the
-- resolution the completion gate demands for an ORPHANED fee (a per-document fee
-- whose accrual trigger — approving the document — never fired), so a matter can
-- never be completed while silently dropping money. It also clears an accrued fee
-- off the Unbilled feed (queries/billing.ts treats fee.waived as a terminal
-- marker, like a void). It is distinct from:
--   • legal.matter.void_fee — removes an accrued ledger entry as a CORRECTION;
--   • legal.fee.decline     — the CLIENT declines a QUOTED fee.
-- Neither carries "the firm chose to forgo owed revenue, and here is why", which is
-- exactly what a waive records — so a new kind is warranted, not a reuse.
--
-- Config-as-data (hard rule 8): the behavior lives in handlers/fee.ts +
-- api/fees.ts; this migration seeds ONLY the definition rows.
--
-- Ids (fresh block, no collision — verified vs main + prod ledger):
--   action legal.fee.waive → …1013-000000000f04 (fee family, after quote/accept/
--     decline f01/f02/f03); event fee.waived → …1014-000000000f04 (after
--     quoted/accepted/declined f01/f02/f03).
-- Lease: 0165 (frontier re-verified at 0164).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── action kind: legal.fee.waive ────────────────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000f04', '00000000-0000-0000-0000-000000000001',
   'legal.fee.waive', 'Waive a fee',
   'The firm''s deliberate, recorded decision not to charge a fee it is owed, with a mandatory reasoning trace. Waive an accrued fee by its ledger event id (it leaves the Unbilled feed), or an orphaned fee a matter never accrued (matter + fee descriptor) — the latter is what lets a matter with a dropped per-document fee finish completing. Distinct from void (a correction) and the client''s fee decline.',
   'notify', 'reversible_with_state_decay', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Same kind for every other legal-vertical tenant (identified by having the
-- service-completion action) that lacks it. Fresh id per tenant.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'legal.fee.waive', 'Waive a fee',
       'The firm''s deliberate, recorded decision not to charge a fee it is owed, with a mandatory reasoning trace. Resolves the completion gate on an orphaned fee and clears an accrued fee off the Unbilled feed. Distinct from void (a correction) and the client''s fee decline.',
       'notify', 'reversible_with_state_decay', NULL, true
FROM (SELECT DISTINCT tenant_id FROM action_kind_definition WHERE kind_name = 'legal.service.complete') t
WHERE t.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM action_kind_definition a
    WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'legal.fee.waive'
  );

-- ── event kind: fee.waived ──────────────────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000f04', '00000000-0000-0000-0000-000000000001',
   'fee.waived', 'Fee waived',
   'A fee was waived — the firm''s recorded decision to forgo it. Names the source ledger event (when waiving an accrued fee) and/or the fee descriptor (document_kind, amount) plus the reason. Terminal marker on the Unbilled feed; resolution for the completion gate.',
   false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT gen_random_uuid(), t.tenant_id, 'fee.waived', 'Fee waived',
       'A fee was waived — the firm''s recorded decision to forgo it, with a reason. Terminal marker on the Unbilled feed; resolution for the completion gate.',
       false
FROM (SELECT DISTINCT tenant_id FROM event_kind_definition WHERE kind_name = 'service_fee.recorded') t
WHERE t.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM event_kind_definition e
    WHERE e.tenant_id = t.tenant_id AND e.kind_name = 'fee.waived'
  );
