-- =============================================================================
-- Vertical migration 0112: create / reschedule / cancel for calendar_event
-- meetings, plus a meeting_with relationship (calendar_event -> client_contact).
--
-- 0025 introduced calendar_event + meeting_of (assign an EXISTING Google event to a
-- matter). This lets the attorney CREATE an event from the app attached to a
-- matter, a CONTACT (meeting_with), or NEITHER (a personal block), and
-- reschedule / cancel it. Matter consultations keep flowing through the existing
-- booking path; calendar_event covers the contact + personal cases.
--
-- PROVENANCE (Hard rule 4): on CREATE the ATTORNEY asserts the event details, so
-- the snapshot attributes carry HUMAN provenance (source_ref = actor) — unlike
-- legal.meeting.assign, where Google observed a pre-existing event (integration).
--
-- Seed-tenant ids verified FREE against prod (jfcarzprfpoztxuqykoe):
--   relationship_kind ...1012-...08 (meeting_of) is the max → meeting_with = ...09.
--   action_kind: the 1013 band already has ...2a (legal.integration.probe), ...30
--   (draft.merge, from 0035) and the ...e1-e5 esign block — so ...30/31/32 are NOT
--   all free (...30 collides with draft.merge). Use ...33/34/35 for create/
--   reschedule/cancel (verified free in files + prod). Configuration-as-data;
--   idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── meeting_with relationship (calendar_event -> client_contact) ──────────────
-- Mirrors meeting_of (calendar_event -> matter); lets a meeting be linked to a
-- person rather than (or as well as) a matter.
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000009', '00000000-0000-0000-0000-000000000001',
   'meeting_with', 'Meeting with', 'A calendar event (meeting) is with a client contact.',
   '00000000-0000-0000-1010-000000000010', '00000000-0000-0000-1010-000000000002',
   'many_to_one', 'directed', 'has_meeting_with')
ON CONFLICT (id) DO NOTHING;

-- ── create / reschedule / cancel actions (app-created meetings) ───────────────
-- create is fully reversible via cancel; reschedule appends a new time (reversible
-- by rescheduling back); cancel deletes the Google event + marks the snapshot
-- cancelled (state decays — the link is kept for history, like reconcile-deleted).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000033', '00000000-0000-0000-0000-000000000001',
   'legal.meeting.create', 'Create meeting',
   'Create a calendar event (matter / contact / personal) and sync it to Google.',
   'notify', 'fully_reversible', 'legal.meeting.cancel', false),
  ('00000000-0000-0000-1013-000000000034', '00000000-0000-0000-0000-000000000001',
   'legal.meeting.reschedule', 'Reschedule meeting',
   'Move an app-created calendar event to a new time (patches the Google event).',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000035', '00000000-0000-0000-0000-000000000001',
   'legal.meeting.cancel', 'Cancel meeting',
   'Cancel an app-created calendar event (deletes the Google event; marks it cancelled).',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
