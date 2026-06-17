-- =============================================================================
-- Vertical migration 0025: Calendar events as meetings (beta sprint Objective 8)
--
-- The CALLS half of Obj 8 shipped (call_session + call_of + listCallsФor*). This
-- is the MEETINGS half: let the attorney assign a Google Calendar event to a
-- matter so it surfaces on that matter's (and its contacts') timeline ALONGSIDE
-- calls. A calendar_event entity mirrors call_session; a meeting_of relationship
-- mirrors call_of (calendar_event -> matter). Assignment lifecycle is the
-- relationship itself: re-route / unassign SEAL the open meeting_of via the
-- seeded foundation mechanism (relationship valid_to), append-only — NOT a new
-- state attribute.
--
-- Provenance split (Hard rule 4): the captured Google snapshot (title, times,
-- attendees, …) is integration:'google:'+id — Google's observation. The attorney
-- asserts only the LINK (the meeting_of relationship, under the human action).
--
-- The id attribute is meeting_google_event_id, NOT google_event_id: the latter is
-- already a matter-bound attribute kind (0001 seed) and lookupKindId resolves by
-- name only, so a second google_event_id would alias.
--
-- Ids verified free against the live pilot DB (entity ≤0009, attribute ≤0038,
-- relationship ≤0007, action ≤0026). Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── calendar_event entity kind ───────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000010', '00000000-0000-0000-0000-000000000001',
   'calendar_event', 'Calendar event', 'A Google Calendar event captured and assigned to a matter (a meeting).',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── calendar_event snapshot attributes (integration:google provenance) ────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000039', '00000000-0000-0000-0000-000000000001',
   'meeting_google_event_id', 'Google event id', 'The Google Calendar event id (idempotency key).',
   '00000000-0000-0000-1010-000000000010', 'text', false),
  ('00000000-0000-0000-1011-000000000040', '00000000-0000-0000-0000-000000000001',
   'meeting_title', 'Meeting title', 'Event summary/title at capture time.',
   '00000000-0000-0000-1010-000000000010', 'text', false),
  ('00000000-0000-0000-1011-000000000041', '00000000-0000-0000-0000-000000000001',
   'meeting_started_at', 'Started at', 'Event start (ISO); minute precision, day for all-day events.',
   '00000000-0000-0000-1010-000000000010', 'datetime', false),
  ('00000000-0000-0000-1011-000000000042', '00000000-0000-0000-0000-000000000001',
   'meeting_ended_at', 'Ended at', 'Event end (ISO); minute precision, day for all-day events.',
   '00000000-0000-0000-1010-000000000010', 'datetime', false),
  ('00000000-0000-0000-1011-000000000043', '00000000-0000-0000-0000-000000000001',
   'meeting_all_day', 'All day', 'True when the event is an all-day (date-only) event.',
   '00000000-0000-0000-1010-000000000010', 'boolean', false),
  ('00000000-0000-0000-1011-000000000044', '00000000-0000-0000-0000-000000000001',
   'meeting_attendee_emails', 'Attendee emails', 'Attendee email addresses at capture time (JSON array).',
   '00000000-0000-0000-1010-000000000010', 'json', true),
  ('00000000-0000-0000-1011-000000000045', '00000000-0000-0000-0000-000000000001',
   'meeting_html_link', 'Open in Google', 'The htmlLink to open the event in Google Calendar.',
   '00000000-0000-0000-1010-000000000010', 'text', false),
  ('00000000-0000-0000-1011-000000000046', '00000000-0000-0000-0000-000000000001',
   'meeting_event_status', 'Event status', 'Google event status (confirmed | tentative | cancelled) at capture.',
   '00000000-0000-0000-1010-000000000010', 'enum', false)
ON CONFLICT (id) DO NOTHING;

-- ── meeting_of relationship (calendar_event -> matter), mirrors call_of ───────
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000008', '00000000-0000-0000-0000-000000000001',
   'meeting_of', 'Meeting of', 'A calendar event (meeting) belongs to a matter.',
   '00000000-0000-0000-1010-000000000010', '00000000-0000-0000-1010-000000000001', 'many_to_one', 'directed', 'has_meeting')
ON CONFLICT (id) DO NOTHING;

-- ── meeting lifecycle actions (writes go through these handlers) ──────────────
-- Re-route / unassign seal the open meeting_of (relationship valid_to); no new
-- archive/seal kind needed — the relationship's own validity carries lifecycle.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000027', '00000000-0000-0000-0000-000000000001',
   'legal.meeting.assign', 'Assign meeting to matter', 'Capture a Google Calendar event and link it to a matter (re-route seals the prior link).',
   'notify', 'fully_reversible', 'legal.meeting.unassign', false),
  ('00000000-0000-0000-1013-000000000028', '00000000-0000-0000-0000-000000000001',
   'legal.meeting.unassign', 'Unassign meeting', 'Detach a meeting from its matter (seals the open meeting_of; history preserved).',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
