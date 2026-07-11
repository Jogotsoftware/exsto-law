-- =============================================================================
-- 0135 — PORTAL-1: clients become real actors + universal fee consent
--
-- Two concepts, config-as-data only (no DDL):
--
--  1. CLIENT PORTAL ACTOR. A portal account maps to a real `actor` row so every
--     portal write (intake, booking, message, payment report, consent) is
--     attributed to the person, not the shared public-intake system actor.
--     The mapping is the `portal_actor_id` attribute on the client_contact
--     entity; the actor row is inserted by the legal.client.provision_portal_actor
--     handler (action layer). The actor's external_id is 'client:<contactId>' —
--     NEVER the email, so the attorney Google sign-in (which resolves actors by
--     lower(external_id)=lower(email)) can never mint an attorney session from a
--     client account.
--
--  2. FEE CONSENT. Nothing billable proceeds unconsented: a quote is presented
--     (legal.fee.quote → fee.quoted) and the client's own actor accepts or
--     declines (legal.fee.accept/decline → fee.accepted/fee.declined, echoing
--     the quoted terms). Billable acts are gated server-side on the acceptance
--     event existing (api/feeConsent.ts assertFeeConsent), never in the UI.
--
-- Id block: …0f00+ (fresh; 0exx was 0115, e1–f1 is the low backfill block).
-- PORTAL-1 lease is 0135–0149 (UI-BUILDER-FIX-1 holds 0120–0134).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kinds ───────────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000f00', '00000000-0000-0000-0000-000000000001',
   'portal_actor_id', 'Portal actor',
   'The actor id this client_contact acts as in the client portal. Written once by legal.client.provision_portal_actor when the portal account is created; every authed portal write runs as this actor.',
   '00000000-0000-0000-1010-000000000002', 'text', false),
  ('00000000-0000-0000-1011-000000000f01', '00000000-0000-0000-0000-000000000001',
   'portal_scheduling_billable', 'Portal scheduling billable',
   'Attorney-set toggle (default absent = OFF): when true, portal-scheduled time for this client is billable at the client''s hourly rate (Contract K: client rate → firm default) and the portal requires a rate × duration fee consent before the booking confirms.',
   '00000000-0000-0000-1010-000000000007', 'boolean', false)
ON CONFLICT (id) DO NOTHING;

-- ── event kinds ───────────────────────────────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000f00', '00000000-0000-0000-0000-000000000001',
   'portal.account_created', 'Portal account created',
   'A client portal account was provisioned: the client_contact got its own actor (portal_actor_id). Payload: client_contact_id, actor_id, trigger (intake_gate | invite | login_backfill). Primary = the client_contact.',
   false),
  ('00000000-0000-0000-1014-000000000f01', '00000000-0000-0000-0000-000000000001',
   'fee.quoted', 'Fee quoted',
   'A fee quote was presented to the client BEFORE a billable act. Payload: client_contact_id, subject_kind (service_booking | scheduled_time | document_review | workflow_fee), subject_key, amount (decimal string, fixed quotes), rate + duration_minutes (hourly quotes), currency, basis (fixed | hourly-rate | review-fee | consultation), description. Primary = matter when known, else the client_contact.',
   false),
  ('00000000-0000-0000-1014-000000000f02', '00000000-0000-0000-0000-000000000001',
   'fee.accepted', 'Fee accepted',
   'The client''s own actor explicitly accepted a presented fee quote. Payload echoes the quoted terms (quote_event_id, subject_kind, subject_key, amount|rate, currency, basis, description) — the consent receipt: who consented, to what amount, for what, when. The billable act is gated server-side on this event existing.',
   false),
  ('00000000-0000-0000-1014-000000000f03', '00000000-0000-0000-0000-000000000001',
   'fee.declined', 'Fee declined',
   'The client''s own actor declined a presented fee quote. Payload mirrors fee.accepted. The gated act does not proceed.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── action kinds ──────────────────────────────────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000f00', '00000000-0000-0000-0000-000000000001',
   'legal.client.provision_portal_actor', 'Provision client portal actor',
   'Create (idempotently) the actor a client_contact acts as in the portal, write the portal_actor_id attribute, emit portal.account_created, and advance any matter parked on a client gate whose via is this action (the send_portal_invite stage). Re-provisioning returns the existing actor.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000f01', '00000000-0000-0000-0000-000000000001',
   'legal.fee.quote', 'Present fee quote',
   'Record that a fee quote was presented to a client before a billable act (fee.quoted event). The quote is computed server-side; the client never supplies the amount.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000f02', '00000000-0000-0000-0000-000000000001',
   'legal.fee.accept', 'Accept fee quote',
   'The client''s own actor accepts a presented fee quote (fee.accepted event referencing the fee.quoted event). This is the consent receipt every billable portal act is gated on.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000f03', '00000000-0000-0000-0000-000000000001',
   'legal.fee.decline', 'Decline fee quote',
   'The client''s own actor declines a presented fee quote (fee.declined event).',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
-- (mirrors 0115's per-tenant backfill: resolve each tenant's own entity-kind ids
-- by name, fresh random ids, idempotent via NOT EXISTS.)
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), cc.tenant_id, 'portal_actor_id', 'Portal actor',
       'The actor id this client_contact acts as in the client portal.',
       cc.id, 'text', false
FROM entity_kind_definition cc
WHERE cc.kind_name = 'client_contact' AND cc.status = 'active'
  AND cc.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = cc.tenant_id AND a.kind_name = 'portal_actor_id'
  );

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), cl.tenant_id, 'portal_scheduling_billable', 'Portal scheduling billable',
       'When true, portal-scheduled time for this client is billable at the client''s hourly rate and requires fee consent before the booking confirms.',
       cl.id, 'boolean', false
FROM entity_kind_definition cl
WHERE cl.kind_name = 'client' AND cl.status = 'active'
  AND cl.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = cl.tenant_id AND a.kind_name = 'portal_scheduling_billable'
  );

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT gen_random_uuid(), t.tenant_id, v.kind_name, v.display_name, v.description, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'client_contact' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
CROSS JOIN (VALUES
  ('portal.account_created', 'Portal account created',
   'A client portal account was provisioned: the client_contact got its own actor.'),
  ('fee.quoted', 'Fee quoted',
   'A fee quote was presented to the client before a billable act.'),
  ('fee.accepted', 'Fee accepted',
   'The client''s own actor explicitly accepted a presented fee quote (the consent receipt).'),
  ('fee.declined', 'Fee declined',
   'The client''s own actor declined a presented fee quote.')
) AS v(kind_name, display_name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM event_kind_definition e
  WHERE e.tenant_id = t.tenant_id AND e.kind_name = v.kind_name
);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, v.kind_name, v.display_name, v.description,
       'notify', 'reversible_with_state_decay', NULL, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'client_contact' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
CROSS JOIN (VALUES
  ('legal.client.provision_portal_actor', 'Provision client portal actor',
   'Create (idempotently) the actor a client_contact acts as in the portal.'),
  ('legal.fee.quote', 'Present fee quote',
   'Record that a fee quote was presented to a client before a billable act.'),
  ('legal.fee.accept', 'Accept fee quote',
   'The client''s own actor accepts a presented fee quote (the consent receipt).'),
  ('legal.fee.decline', 'Decline fee quote',
   'The client''s own actor declines a presented fee quote.')
) AS v(kind_name, display_name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = v.kind_name
);
