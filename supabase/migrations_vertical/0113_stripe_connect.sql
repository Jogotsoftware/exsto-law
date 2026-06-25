-- =============================================================================
-- Vertical migration 0113: online invoice payments — Stripe Connect (firm side)
--
-- Lets a firm connect online card/ACH payments. exsto-law is the Stripe Connect
-- PLATFORM; each firm onboards as an Express CONNECTED ACCOUNT. A client then pays
-- an issued invoice on an embedded Payment Element, and the existing invoice.pay
-- action (method='stripe') flips the invoice to paid from the Stripe webhook —
-- migration 0090 already anticipated this caller, so no billing schema changes.
--
-- What the firm needs to remember is small and is NOT secret: the connected
-- account id (acct_…) and two capability flags Stripe reports. The connected
-- account id is a PUBLIC identifier, not a credential — the only secrets are the
-- PLATFORM's Stripe keys, which are env vars (no per-firm Vault entry). So this is
-- modeled as config-as-data (invariant 8) on the SAME singleton firm_settings
-- entity Contract K introduced (migration 0065, entity kind …1010-000000000501),
-- effective-dated and versioned through the action layer like every other fact.
--
-- This migration adds, on firm_settings:
--   • stripe_connected_account_id (text)    — the firm's Express acct_… id
--   • stripe_charges_enabled      (boolean) — Stripe says the account can charge
--   • stripe_details_submitted    (boolean) — onboarding info fully submitted
-- and two action kinds:
--   • legal.firm.connect_stripe    — record/update the acct id + capability flags
--                                    (written at onboarding start and on each
--                                    capability refresh / account.updated webhook)
--   • legal.firm.disconnect_stripe — clear the connection (stop accepting online
--                                    payments); the account itself lives on at
--                                    Stripe and can be reconnected.
--
-- Configuration-as-data (invariant 8): kinds are rows, not code. Data-only;
-- idempotent (ON CONFLICT DO NOTHING).
--
-- Ids: fresh 0c00 block — attribute 1011-000000000c00..c02, action 1013-
-- 000000000c00..c01 — chosen above the highest id in each family on origin/main
-- (attr …a03, action …b00) AND the prod ledger (max applied 0109), so it can land
-- in any merge order without colliding. Migration number 0113 is above origin/main
-- (max 0112) and prod (max 0109).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kinds on firm_settings (the Contract-K singleton) ──────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000c00', '00000000-0000-0000-0000-000000000001',
   'stripe_connected_account_id', 'Stripe connected account id',
   'The firm''s Stripe Connect Express connected-account id (acct_…). A public identifier, not a secret. Set when the firm starts onboarding; effective-dated by valid_from.',
   '00000000-0000-0000-1010-000000000501', 'text', false),
  ('00000000-0000-0000-1011-000000000c01', '00000000-0000-0000-0000-000000000001',
   'stripe_charges_enabled', 'Stripe charges enabled',
   'Whether Stripe reports the firm''s connected account can accept charges (charges_enabled). Refreshed from retrieveAccount on the onboarding return and the account.updated webhook.',
   '00000000-0000-0000-1010-000000000501', 'boolean', false),
  ('00000000-0000-0000-1011-000000000c02', '00000000-0000-0000-0000-000000000001',
   'stripe_details_submitted', 'Stripe details submitted',
   'Whether the firm has fully submitted its Express onboarding details (details_submitted). Drives the "finish setup" prompt in Settings.',
   '00000000-0000-0000-1010-000000000501', 'boolean', false)
ON CONFLICT (id) DO NOTHING;

-- ── action kinds: connect / disconnect ───────────────────────────────────────
-- Recording the connection (and refreshing its capability flags) supersedes the
-- prior attribute rows append-only; history is preserved. 'notify' /
-- 'reversible_with_state_decay' mirror the other firm_settings action
-- (legal.firm.set_default_rate). Disconnect is the reverse of connect.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000c00', '00000000-0000-0000-0000-000000000001',
   'legal.firm.connect_stripe', 'Connect Stripe payments',
   'Record or update the firm''s Stripe connected-account id and capability flags (charges_enabled, details_submitted) on the firm_settings singleton. Written at onboarding start and on each capability refresh.',
   'notify', 'reversible_with_state_decay', 'legal.firm.disconnect_stripe', false),
  ('00000000-0000-0000-1013-000000000c01', '00000000-0000-0000-0000-000000000001',
   'legal.firm.disconnect_stripe', 'Disconnect Stripe payments',
   'Clear the firm''s Stripe connection so it stops accepting online payments. The connected account persists at Stripe and can be reconnected; this only supersedes the local flags.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
