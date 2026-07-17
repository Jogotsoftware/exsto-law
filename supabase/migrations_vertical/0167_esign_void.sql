-- =============================================================================
-- Vertical migration 0167: E-signature VOID (Legal Instruments WP-N)
--
-- Configuration-as-data (invariant 12 / 23): void is composed from the existing
-- e-sign primitives — no schema change, no new tables. It is the attorney-side
-- close for an envelope that must be pulled back before completion (wrong doc,
-- wrong signer, superseded terms). It is DISTINCT from esign.decline (a signer
-- declining): void is firm-initiated and closes every still-open signer request.
--
-- Concepts added:
--   action kind   esign.void    (attorney voids an active envelope; each open
--                                signer request is closed so a stale link can no
--                                longer be used to sign)
--   event kind    esign.voided  (the envelope was voided by the firm)
--
-- Lifecycle: sent / pending_dispatch  --esign.void-->  voided (terminal). The
-- handler sets envelope_status = 'voided' and every unresolved signer_status
-- (pending | delivered | opened) = 'voided'; assertSignerTurn then rejects any
-- further sign/decline on that request. Completed / declined / already-voided
-- envelopes cannot be voided.
--
-- Ids: reuse the e-sign e-block (0043/0044). Actions e1..e5 are taken
-- (send/sign/decline/record_status/open) → void is e6; events e1..e6 are taken
-- (sent/signed/completed/declined/delivered/opened) → voided is e7.
-- Idempotent (ON CONFLICT (id) DO NOTHING).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── action kind: firm-initiated void ─────────────────────────────────────────
-- Attorney-initiated close of an active envelope. Autonomy 'notify' (a human
-- action with client-visible effect), reversibility 'reversible_with_state_decay'
-- (a voided envelope is superseded by sending a fresh one; the void row itself is
-- a fact, not undone in place). No reasoning trace required.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-0000000000e6', '00000000-0000-0000-0000-000000000001',
   'esign.void', 'Void envelope',
   'The firm voids an active signature envelope before completion; every still-open signer request is closed so its link can no longer be used to sign.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── event kind: the envelope was voided ──────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-0000000000e7', '00000000-0000-0000-0000-000000000001',
   'esign.voided', 'Envelope voided', 'The firm voided the envelope before completion; open signer requests were closed.', true)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
