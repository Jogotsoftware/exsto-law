-- =============================================================================
-- Vertical migration 0006: notification routes (Phase 0, WP6 — REQ-NOTIFY-01..03)
--
-- Provider-agnostic notification configuration as DATA: notification_route_
-- definition rows (core registry). Adding SMS later = new rows + an sms driver,
-- zero call-site changes. NO SMS rows in Phase 0. Data-only; idempotent.
-- Routes anchor to the vertical seed's system.bootstrap action (0001 seed).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO notification_route_definition
  (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config) VALUES
  ('00000000-0000-0000-1030-000000000001', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'attorney_manual_matter', 'Attorney: manual-workflow matter opened',
   'email', '{"role":"attorney"}'::jsonb, 'attorney-manual-matter',
   '{"critical":true,"reason":"manual matters may lack a calendar event; email is the safety net"}'::jsonb),
  ('00000000-0000-0000-1030-000000000002', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'attorney_draft_completed', 'Attorney: async draft completed',
   'email', '{"role":"attorney"}'::jsonb, 'attorney-draft-completed', '{}'::jsonb),
  ('00000000-0000-0000-1030-000000000003', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'prospect_intake_confirmation', 'Prospect: intake received',
   'email', '{"role":"prospect"}'::jsonb, 'prospect-intake-confirmation', '{}'::jsonb),
  ('00000000-0000-0000-1030-000000000004', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'prospect_booking_confirmation', 'Prospect: consultation booked',
   'email', '{"role":"prospect"}'::jsonb, 'prospect-booking-confirmation', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
