-- =============================================================================
-- Vertical migration 0070: feedback-resolution in-app notifications
--
-- Closes the beta-feedback loop. When an admin/agent resolves a feedback item
-- (the legal.assistant.feedback_resolve tool), we record an
-- assistant.feedback_resolved event addressed to the attorney who SUBMITTED the
-- feedback (the original assistant.turn's source_ref). The nav notification bell
-- reads these for the current actor and links back to the exact page they were
-- on (page_context.path), carried forward on the resolution event.
--
-- Read-state is itself substrate data (append-only, no UPDATE): a notification.seen
-- event records the timestamp an attorney last opened the bell. Unread = resolved
-- events newer than that actor's latest seen_through. Both recorded via the generic
-- event.record action — no new action kind, just two new event kinds (ADR 0012,
-- schema-as-data). Neither is a state change (they observe; they transition nothing).
--
-- Data-only; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000405', '00000000-0000-0000-0000-000000000001',
   'assistant.feedback_resolved', 'Feedback resolved',
   'A piece of beta feedback (an assistant.turn with kind=feedback) was actioned. Payload carries feedback_event_id (the original), recipient_actor_id (the submitter, notified in-app), an optional resolution note, link_path (the page the feedback was given on, for the deep link), an excerpt of the original message, and its category. primary_entity_id mirrors the original feedback so the resolution threads on the same matter/contact when there was one.',
   false),
  ('00000000-0000-0000-1014-000000000406', '00000000-0000-0000-0000-000000000001',
   'notification.seen', 'Notifications seen',
   'Records that an actor opened their in-app notifications. The event''s own occurred_at is the "seen through" line: unread for an actor = assistant.feedback_resolved events addressed to them (recipient_actor_id) that occurred after their latest notification.seen. source_ref is the actor; primary_entity_id is null (it is not about an entity).',
   false)
ON CONFLICT (id) DO NOTHING;
