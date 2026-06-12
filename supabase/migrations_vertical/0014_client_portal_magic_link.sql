-- =============================================================================
-- Vertical migration 0014: client-portal magic-link notification route
--
-- Adds the notification_route_definition row the client portal uses to email a
-- magic sign-in link to a client_contact. Configuration as DATA: the route names
-- the channel (email), the recipient role (client), and the template_ref the
-- renderer keys on ('client-portal-magic-link'). The portal always passes an
-- explicit `to` (the on-file contact email), so recipient-role resolution is a
-- backstop, not the primary path.
--
-- DATA-ONLY: zero DDL, zero new tables (schema-as-data). Idempotent: fixed UUID
-- + ON CONFLICT DO NOTHING; re-running inserts nothing. Anchors to the vertical
-- seed's system.bootstrap action (0001), same as the other route rows (0006).
--
-- UUID scheme: continues the notification-route block from 0006
--   (00000000-0000-0000-1030-00000000000N), this is ...0005.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO notification_route_definition
  (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config) VALUES
  ('00000000-0000-0000-1030-000000000005', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'client_portal_magic_link', 'Client: portal sign-in link',
   'email', '{"role":"client"}'::jsonb, 'client-portal-magic-link', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
