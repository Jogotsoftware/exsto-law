-- =============================================================================
-- 0161 — CLIENT-PORTAL-UI-1: the firm-level engagement agreement + portal
-- notification read-state. Config-as-data only (no DDL).
--
--  1. ENGAGEMENT AGREEMENT (WP-6, founder-decided model). ONE firm-level
--     agreement per client: the standard hourly rate + the firm's terms.
--     Sign once → client-initiated messaging and booking unlock and stay
--     unlocked. The rate is READ from firm config (firm_default_hourly_rate,
--     0065) and the terms from the engagement_terms attribute below — the
--     acceptance event echoes the rate + terms version it bound to (the
--     consent receipt). Enforcement is server-side at the operation core
--     (api/engagement.ts assertEngagementAccepted), never in the UI.
--     The existing PER-QUOTE fee consent (0135) is UNCHANGED — it covers
--     service fees; the engagement covers hourly messaging/booking.
--
--  2. PORTAL NOTIFICATION READ-STATE (WP-3). The notifications feed is a READ
--     projection over the existing ledgers (attorney.message.post,
--     invoice.send, esign.send, booking.*, document approvals) — no parallel
--     notification pipeline. "Read" is APPEND-ONLY: portal.notification.read
--     records a watermark; unread = feed items newer than the latest
--     watermark. No fact row is ever updated or deleted.
--
--  3. PER-CLIENT ASSISTANT FLAG (WP-7). portal_assistant_enabled on the
--     client entity (default absent = OFF): the floating assistant bubble
--     renders only for enabled clients. Set via legal.client.update like
--     portal_scheduling_billable.
--
-- Id block: …fa0+ (fresh; 0135 holds f00–f03, f50 is taken).
-- Lease: 0161 (frontier re-verified at 0160 on 2026-07-13).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kinds ───────────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000000fa0', '00000000-0000-0000-0000-000000000001',
       'engagement_terms', 'Engagement terms',
       'The firm''s engagement-agreement terms shown in the client portal gate: json {text, version, published_at}. Attorney-supplied via legal.firm.set_engagement_terms (each publish bumps version); the client''s acceptance records the version it bound to.',
       ekd.id, 'json', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'firm_settings' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000000fa1', '00000000-0000-0000-0000-000000000001',
       'portal_assistant_enabled', 'Portal assistant enabled',
       'Attorney-set toggle (default absent = OFF): when true, the signed-in client sees the floating portal assistant. Set via legal.client.update, like portal_scheduling_billable.',
       ekd.id, 'boolean', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'client' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

-- ── event kinds ───────────────────────────────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000fa0', '00000000-0000-0000-0000-000000000001',
   'engagement.accepted', 'Engagement agreement accepted',
   'The client''s own actor accepted the firm''s engagement agreement. Payload: client_contact_id, rate (the firm standard hourly rate at acceptance, decimal string), currency, terms_version (the engagement_terms version bound to). Primary = the client_contact. Client-initiated messaging and booking are gated server-side on this event existing.',
   false),
  ('00000000-0000-0000-1014-000000000fa1', '00000000-0000-0000-0000-000000000001',
   'engagement.declined', 'Engagement agreement declined',
   'The client''s own actor declined the firm''s engagement agreement. Payload mirrors engagement.accepted. Messaging/booking stay locked.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── action kinds ──────────────────────────────────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000fa0', '00000000-0000-0000-0000-000000000001',
   'legal.engagement.accept', 'Accept engagement agreement',
   'The client''s own actor accepts the firm-level engagement agreement (engagement.accepted event echoing the CURRENT firm rate + terms version, both resolved server-side — the client never supplies them). One-time: messaging and booking unlock and stay unlocked.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000fa1', '00000000-0000-0000-0000-000000000001',
   'legal.engagement.decline', 'Decline engagement agreement',
   'The client''s own actor declines the firm-level engagement agreement (engagement.declined event).',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000fa2', '00000000-0000-0000-0000-000000000001',
   'legal.firm.set_engagement_terms', 'Set engagement terms',
   'Attorney publishes the firm''s engagement-agreement terms text (engagement_terms attribute on the firm_settings singleton; each publish bumps version). The portal gate renders the current version; acceptances bind to it.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000fa3', '00000000-0000-0000-0000-000000000001',
   'portal.notification.read', 'Portal notifications read',
   'The signed-in client marked their portal notifications as read (append-only watermark: payload {client_contact_id, read_at}). Unread badge = feed items newer than the latest watermark. Never an UPDATE on a fact row.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── client.portal scope: allow the three client-fired kinds ──────────────────
-- The RBAC allowlist (0136) is enforced by the 0073 RESTRICTIVE policy through
-- actor_scope_assignment → permission_scope_definition BY ID, so the amendment
-- is an in-place jsonb append on the ACTIVE row (sealing + reinserting would
-- orphan every existing client actor's assignment). Idempotent via the ? guard;
-- provenance = the config.change action row below, mirroring 0136.
DO $$
DECLARE
  t record;
  v_action uuid;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM permission_scope_definition
    WHERE scope_name = 'client.portal' AND (valid_to IS NULL OR valid_to > now())
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    v_action := NULL;
    INSERT INTO action (id, tenant_id, actor_id, action_kind_id, intent_kind, autonomy_tier,
                        hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
    SELECT gen_random_uuid(), t.tenant_id, a.id, akd.id, 'enforcement', 'autonomous',
           now(), 0, a.id, '{"reason": "0161_client_portal_engagement_notifications"}'::jsonb
    FROM actor a
    JOIN action_kind_definition akd
      ON akd.tenant_id = t.tenant_id AND akd.kind_name = 'config.change'
    WHERE a.tenant_id = t.tenant_id AND a.actor_type = 'system' AND a.status = 'active'
    ORDER BY a.created_at
    LIMIT 1
    RETURNING id INTO v_action;

    IF v_action IS NULL THEN
      RAISE NOTICE 'tenant % has no system actor or config.change kind; skipped', t.tenant_id;
      CONTINUE;
    END IF;

    UPDATE permission_scope_definition
    SET action_kinds = action_kinds
        || CASE WHEN NOT action_kinds ? 'legal.engagement.accept'
                THEN '["legal.engagement.accept"]'::jsonb ELSE '[]'::jsonb END
        || CASE WHEN NOT action_kinds ? 'legal.engagement.decline'
                THEN '["legal.engagement.decline"]'::jsonb ELSE '[]'::jsonb END
        || CASE WHEN NOT action_kinds ? 'portal.notification.read'
                THEN '["portal.notification.read"]'::jsonb ELSE '[]'::jsonb END
    WHERE tenant_id = t.tenant_id AND scope_name = 'client.portal'
      AND (valid_to IS NULL OR valid_to > now());
  END LOOP;
END $$;

-- ── Same kinds for EVERY OTHER existing tenant ────────────────────────────────
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), fs.tenant_id, 'engagement_terms', 'Engagement terms',
       'The firm''s engagement-agreement terms shown in the client portal gate: json {text, version, published_at}.',
       fs.id, 'json', false
FROM entity_kind_definition fs
WHERE fs.kind_name = 'firm_settings' AND fs.status = 'active'
  AND fs.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = fs.tenant_id AND a.kind_name = 'engagement_terms'
  );

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), cl.tenant_id, 'portal_assistant_enabled', 'Portal assistant enabled',
       'When true, the signed-in client sees the floating portal assistant.',
       cl.id, 'boolean', false
FROM entity_kind_definition cl
WHERE cl.kind_name = 'client' AND cl.status = 'active'
  AND cl.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = cl.tenant_id AND a.kind_name = 'portal_assistant_enabled'
  );

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT gen_random_uuid(), t.tenant_id, v.kind_name, v.display_name, v.description, false
FROM (SELECT DISTINCT tenant_id FROM entity_kind_definition
      WHERE kind_name = 'client_contact' AND status = 'active'
        AND tenant_id <> '00000000-0000-0000-0000-000000000001') t
CROSS JOIN (VALUES
  ('engagement.accepted', 'Engagement agreement accepted',
   'The client''s own actor accepted the firm''s engagement agreement (rate + terms version echoed).'),
  ('engagement.declined', 'Engagement agreement declined',
   'The client''s own actor declined the firm''s engagement agreement.')
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
  ('legal.engagement.accept', 'Accept engagement agreement',
   'The client''s own actor accepts the firm-level engagement agreement.'),
  ('legal.engagement.decline', 'Decline engagement agreement',
   'The client''s own actor declines the firm-level engagement agreement.'),
  ('legal.firm.set_engagement_terms', 'Set engagement terms',
   'Attorney publishes the firm''s engagement-agreement terms text.'),
  ('portal.notification.read', 'Portal notifications read',
   'The signed-in client marked their portal notifications as read (append-only watermark).')
) AS v(kind_name, display_name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
  WHERE a.tenant_id = t.tenant_id AND a.kind_name = v.kind_name
);
