-- =============================================================================
-- Vertical migration 0115: manual payment methods — Zelle + crypto wallets
--
-- Stripe (0113) covers card/ACH. Firms also accept payments that have NO
-- processor API: Zelle (bank-app transfer to the firm's enrolled email/phone)
-- and direct crypto transfers to a firm wallet address. Neither can be charged
-- programmatically, so the model is instruct-then-verify:
--
--   1. The firm configures its Zelle recipient + crypto wallet addresses once
--      (Settings → Payments). Stored as ONE JSON config attribute on the
--      firm_settings singleton — config-as-data (invariant 8), append-only,
--      effective-dated, exactly like invoice_template_config (0092 pattern).
--   2. The client payment page (/portal/pay/<invoice>) shows the instructions:
--      a Zelle QR/deep link and per-wallet crypto addresses with QR codes.
--   3. The client REPORTS the payment they made — method, a verification
--      reference (Zelle confirmation number / crypto transaction hash), and an
--      optional screenshot — recorded as an invoice.payment_reported event.
--   4. The attorney verifies (bank app / block explorer / screenshot) and marks
--      the invoice paid via the EXISTING invoice.pay action (0090 seam), or
--      dismisses a bogus report (invoice.payment_report_dismissed — corrections
--      are new rows; events are never deleted).
--
-- This migration adds:
--   • attribute kind manual_payment_methods_config (json, firm_settings)
--   • action kind   legal.firm.set_manual_payment_methods
--   • event kinds   invoice.payment_reported, invoice.payment_report_dismissed
--
-- Configuration-as-data (invariant 8): kinds are rows, not code. Data-only;
-- idempotent (ON CONFLICT DO NOTHING).
--
-- Ids: fresh 0e00 block — attribute 1011-000000000e00, action 1013-000000000e00,
-- events 1014-000000000e00..e01 — chosen above the highest id in each family on
-- origin/main (attr …d03, action …d02) AND unused anywhere in the repo, so it can
-- land in any merge order without colliding. Migration number 0115 is above
-- origin/main (max 0114).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kind on firm_settings (the Contract-K singleton) ────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000e00', '00000000-0000-0000-0000-000000000001',
   'manual_payment_methods_config', 'Manual payment methods',
   'The firm''s instruct-then-verify payment rails, shown to clients on the invoice payment page: {zelle: {recipient, recipientName} | null, wallets: [{label, currency, network, address}]}. The Zelle recipient is the firm''s enrolled email/phone (semi-public payment identity, not a credential); wallet addresses are public by nature. A new write supersedes the prior config append-only.',
   '00000000-0000-0000-1010-000000000501', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── action kind: set the config ───────────────────────────────────────────────
-- 'notify' / 'reversible_with_state_decay' mirror the other firm_settings actions
-- (legal.firm.set_default_rate, legal.firm.set_invoice_template).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000e00', '00000000-0000-0000-0000-000000000001',
   'legal.firm.set_manual_payment_methods', 'Set manual payment methods',
   'Record the firm''s Zelle recipient and crypto wallet addresses (the manual_payment_methods_config JSON attribute on the firm_settings singleton). Shown to clients as pay-by-instruction options; a new write supersedes the prior config.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── event kinds: client-reported payments + attorney dismissal ────────────────
-- payment_reported is a CLAIM, not a state change — the invoice stays due until
-- the attorney verifies and invoice.pay (0090) flips it. Dismissal is likewise a
-- correction event referencing the report it retires (append-only; no deletes).
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000e00', '00000000-0000-0000-0000-000000000001',
   'invoice.payment_reported', 'Invoice payment reported',
   'A client reported having paid an invoice by an instruct-then-verify method. Payload: method (zelle | crypto), reference (Zelle confirmation number / crypto tx hash), payer_name, note, wallet (label/currency the client says they paid to), screenshot_key (Storage object of the uploaded proof, if any), client_contact_id. Primary=invoice. The invoice is NOT paid by this event — the attorney verifies then calls invoice.pay.',
   false),
  ('00000000-0000-0000-1014-000000000e01', '00000000-0000-0000-0000-000000000001',
   'invoice.payment_report_dismissed', 'Invoice payment report dismissed',
   'The attorney reviewed a client payment report and dismissed it (could not verify / duplicate / mistaken). Payload: report_event_id (the invoice.payment_reported event this retires), reason. Primary=invoice. Append-only correction — the original report stays in history.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
-- Kinds are strictly per-tenant (mirrors 0113's "seed for every firm" section):
-- resolve each tenant's OWN firm_settings entity kind by name (cloned tenants get
-- remapped ids), fresh random kind ids, idempotent via NOT EXISTS. Tenants created
-- AFTER this migration inherit the kinds from the tenant-zero registry clone.
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), fs.tenant_id, 'manual_payment_methods_config', 'Manual payment methods',
       'The firm''s instruct-then-verify payment rails (Zelle recipient + crypto wallets) shown on the invoice payment page.',
       fs.id, 'json', false
FROM entity_kind_definition fs
WHERE fs.kind_name = 'firm_settings'
  AND fs.status = 'active'
  AND fs.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = fs.tenant_id AND a.kind_name = 'manual_payment_methods_config'
  );

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'legal.firm.set_manual_payment_methods', 'Set manual payment methods',
       'Record the firm''s Zelle recipient and crypto wallet addresses on the firm_settings singleton.',
       'notify', 'reversible_with_state_decay', NULL, false
FROM (
  SELECT DISTINCT tenant_id
  FROM entity_kind_definition
  WHERE kind_name = 'firm_settings' AND status = 'active'
    AND tenant_id <> '00000000-0000-0000-0000-000000000001'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'legal.firm.set_manual_payment_methods'
);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT gen_random_uuid(), t.tenant_id, k.kind_name, k.display_name, k.description, false
FROM (
  SELECT DISTINCT tenant_id
  FROM entity_kind_definition
  WHERE kind_name = 'firm_settings' AND status = 'active'
    AND tenant_id <> '00000000-0000-0000-0000-000000000001'
) t
CROSS JOIN (VALUES
  ('invoice.payment_reported', 'Invoice payment reported',
   'A client reported having paid an invoice by an instruct-then-verify method (Zelle/crypto); the attorney verifies then calls invoice.pay.'),
  ('invoice.payment_report_dismissed', 'Invoice payment report dismissed',
   'The attorney reviewed a client payment report and dismissed it; the original report stays in history.')
) AS k(kind_name, display_name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM event_kind_definition e
  WHERE e.tenant_id = t.tenant_id AND e.kind_name = k.kind_name
);
