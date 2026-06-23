-- =============================================================================
-- Vertical migration 0091: client-portal set-password invite notification route
--
-- Adds the notification_route_definition row the attorney's
-- `legal.contact.invite_to_portal` tool uses to email a client_contact a secure
-- "set up your portal access" link. Configuration as DATA: the route names the
-- channel (email), the recipient role (client), and the template_ref the renderer
-- keys on ('client-portal-invite'). The invite tool always passes an explicit
-- `to` (the on-file contact email), so recipient-role resolution is a backstop,
-- not the primary path. Mirrors the client-portal magic-link route (0014).
--
-- DATA-ONLY: zero DDL, zero new tables (schema-as-data). Idempotent: fixed UUID
-- + ON CONFLICT DO NOTHING; re-running inserts nothing. Anchors to the vertical
-- seed's system.bootstrap action (0001), same as the other route rows (0006/0014).
--
-- UUID scheme: continues the notification-route block
--   (00000000-0000-0000-1030-00000000000N); ...0001–0009 are taken, this is ...0010.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO notification_route_definition
  (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config) VALUES
  ('00000000-0000-0000-1030-000000000010', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'client_portal_invite', 'Client: portal set-up invite',
   'email', '{"role":"client"}'::jsonb, 'client-portal-invite', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
