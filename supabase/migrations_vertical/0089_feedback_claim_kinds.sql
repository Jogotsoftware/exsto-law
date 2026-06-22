-- =============================================================================
-- Vertical migration 0089: beta-feedback "claimed / in-progress" status
--
-- Beta feedback (assistant.turn with kind=feedback) only had two states: open
-- (no resolution) and resolved (an assistant.feedback_resolved event). With many
-- parallel sessions, two would pick up the SAME item — there was no "someone is
-- already on this" signal. This adds a CLAIM marker so a session can mark an item
-- in-progress (and release it if abandoned), giving a three-state backlog:
-- open → in_progress → resolved.
--
-- Mirrors the resolution model (migration 0070): just new EVENT kinds, emitted via
-- the generic event.record action (no new action kind). Neither is a state change
-- (they observe a coordination fact; they transition no substrate state).
--   • assistant.feedback_claimed  — payload { feedback_event_id, claimed_by (a
--     branch/session/PR label), note, excerpt, category }. primary_entity_id
--     mirrors the original feedback.
--   • assistant.feedback_released — payload { feedback_event_id, released_by, note }.
--     A claim is "live" only while the latest claim for an item post-dates the
--     latest release for it; resolving always wins.
--
-- Ids: 1014-…0810/0811 (the 08xx event sub-block, verified free on prod and clear
-- of the 040x billing/feedback/upload range). Data-only; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000810', '00000000-0000-0000-0000-000000000001',
   'assistant.feedback_claimed', 'Feedback claimed',
   'A session/agent took ownership of a beta-feedback item (an assistant.turn with kind=feedback) so others do not duplicate it. Payload: feedback_event_id (the original), claimed_by (a branch/session/PR label), an optional note, an excerpt of the original message, and its category. primary_entity_id mirrors the original feedback. The claim is in effect while it is the latest claim for the item AND post-dates any assistant.feedback_released for it; a resolution supersedes it.',
   false),
  ('00000000-0000-0000-1014-000000000811', '00000000-0000-0000-0000-000000000001',
   'assistant.feedback_released', 'Feedback released',
   'A session/agent gave up a claim on a beta-feedback item (abandoned or superseded), returning it to the open pool. Payload: feedback_event_id (the original), released_by, and an optional note. The item is in_progress again only if a newer assistant.feedback_claimed follows this.',
   false)
ON CONFLICT (id) DO NOTHING;
