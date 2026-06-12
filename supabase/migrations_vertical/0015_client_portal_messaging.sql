-- =============================================================================
-- Vertical migration 0015: client portal messaging (Client Portal PR2)
--
-- Two-way client↔attorney messaging, REUSING the core communication tables
-- (communication_thread + communication_message, core 0009 — append-only). NO
-- new tables, NO DDL, NO ALTER on the core thread_kind CHECK: one portal thread
-- per matter reuses thread_kind 'email' and is tagged channel:'portal' in the
-- thread participants jsonb, with related_entity_ids=[matterEntityId] so the
-- attorney's matterCommunications read picks it up for free.
--
-- Configuration-as-data (hard rule 8): everything here is definition ROWS —
-- action kinds, event kinds, notification routes. v1.0.1: every action kind MUST
-- have a registered handler — the handlers ship in
-- verticals/legal/src/handlers/clientMessage.ts.
--
-- Provenance model (the message INSERT, done in the handler):
--   • client message:  sender_entity_id=clientContactId, sender_actor_id=NULL,
--                       source_type='human', source_ref='client_contact:<id>',
--                       payload.author='client'.
--   • attorney message: sender_actor_id=<attorney actorId>, sender_entity_id=NULL,
--                       source_type='human', source_ref='actor:<id>',
--                       payload.author='attorney'.
--
-- Notification emails carry NO message body — they link to the portal (client)
-- or the attorney matter page (attorney).
--
-- DATA-ONLY: fixed UUIDs + ON CONFLICT DO NOTHING make this idempotent. UUID
-- scheme continues the vertical blocks:
--   action kinds        00000000-0000-0000-1013-0000000000NN  (next: 17, 18)
--   event kinds         00000000-0000-0000-1014-00000000000N
--                       (a=research.recorded, b=feedback.recorded already taken;
--                        this uses d=client.message.received, c=attorney.message.sent)
--   notification routes 00000000-0000-0000-1030-00000000000N  (next: 6, 7)
-- All rows anchor to the vertical seed's system.bootstrap action (0001), same as
-- the other definition rows.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- -----------------------------------------------------------------------------
-- Action kinds. Both autonomy 'autonomous' + 'irreversible' (a posted message is
-- a published, append-only communication — like mail.send / mail.ingest, it
-- cannot be un-said; corrections are new messages). Neither requires a reasoning
-- trace: these are human communications, not AI judgments.
-- -----------------------------------------------------------------------------
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000017', '00000000-0000-0000-0000-000000000001',
   'client.message.post',   'Post client portal message',
   'A signed-in client posts a message to the attorney on the matter''s portal thread (append-only; sender_entity_id = client_contact).',
   'autonomous', 'irreversible', NULL, false),
  ('00000000-0000-0000-1013-000000000018', '00000000-0000-0000-0000-000000000001',
   'attorney.message.post', 'Post attorney portal message',
   'The attorney replies to the client on the matter''s portal thread (append-only; sender_actor_id = attorney actor).',
   'autonomous', 'irreversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Event kinds — portal message lifecycle on the matter timeline.
-- -----------------------------------------------------------------------------
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-00000000000d', '00000000-0000-0000-0000-000000000001',
   'client.message.received', 'Client portal message received',
   'A client posted a message to the attorney on the matter''s portal thread.', false),
  ('00000000-0000-0000-1014-00000000000c', '00000000-0000-0000-0000-000000000001',
   'attorney.message.sent',   'Attorney portal message sent',
   'The attorney posted a reply to the client on the matter''s portal thread.', false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Notification routes (configuration as DATA). NO message body in the email —
-- the templates link to the portal / matter page only.
--   attorney_portal_message → attorney (role-resolved on-file address)
--   client_portal_message   → the client's on-file email (handler passes `to`)
-- -----------------------------------------------------------------------------
INSERT INTO notification_route_definition
  (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config) VALUES
  ('00000000-0000-0000-1030-000000000006', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'attorney_portal_message', 'Attorney: new client portal message',
   'email', '{"role":"attorney"}'::jsonb, 'attorney-portal-message', '{}'::jsonb),
  ('00000000-0000-0000-1030-000000000007', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'client_portal_message', 'Client: new attorney portal message',
   'email', '{"role":"client"}'::jsonb, 'client-portal-message', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
