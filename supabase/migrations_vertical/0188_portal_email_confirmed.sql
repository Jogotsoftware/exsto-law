-- =============================================================================
-- Vertical migration 0188: legal.client.confirm_portal_email action +
-- portal.email_confirmed event
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR.
--
-- N1 (client onboarding): the client proving control of their email by
-- following the confirmation link is itself a fact worth keeping — who
-- confirmed, when, which account. Recorded through the action layer like every
-- other client-actor write (legal.client.provision_portal_actor sibling).
-- Idempotent: a second confirm (resend clicked twice, page reloaded) reuses
-- the existing event rather than duplicating it.
--
-- Ids: fresh …3100 sub-block in the 1013 (action_kind) / 1014 (event_kind)
-- ranges (0184 took …3000).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000003100', '00000000-0000-0000-0000-000000000001',
   'portal.email_confirmed', 'Portal email confirmed',
   'The client proved control of their portal account email by following the confirmation link (or completing the OTP verification). Payload: client_contact_id, actor_id. Primary = the client_contact.',
   false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000003100', '00000000-0000-0000-0000-000000000001',
   'legal.client.confirm_portal_email', 'Confirm portal email',
   'Record that the client proved control of their portal account email (portal.email_confirmed event). Idempotent — re-confirming returns the existing event.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT gen_random_uuid(), t.tenant_id, 'portal.email_confirmed', 'Portal email confirmed',
       'The client proved control of their portal account email by following the confirmation link.',
       false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'client_contact' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
WHERE NOT EXISTS (
  SELECT 1 FROM event_kind_definition e
  WHERE e.tenant_id = t.tenant_id AND e.kind_name = 'portal.email_confirmed'
);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
SELECT gen_random_uuid(), t.tenant_id, 'legal.client.confirm_portal_email', 'Confirm portal email',
       'Record that the client proved control of their portal account email (idempotent).',
       'notify', 'reversible_with_state_decay', NULL, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'client_contact' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = 'legal.client.confirm_portal_email'
);
