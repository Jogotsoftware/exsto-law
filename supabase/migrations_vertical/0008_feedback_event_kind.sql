-- =============================================================================
-- Vertical migration 0008: feedback.recorded event kind
--
-- The in-app feedback chatbot in the attorney workspace records every exchange
-- (the attorney's message + the assistant's reply) as a feedback.recorded event,
-- with provenance human:actor_id. Feedback is auditable substrate data, not a
-- fire-and-forget form. Configuration-as-data: a new event kind is a row, not
-- code. Not a state change (it observes; it does not transition a matter).
-- Data-only; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-00000000000b', '00000000-0000-0000-0000-000000000001',
   'feedback.recorded', 'Feedback recorded',
   'An attorney left feedback or asked a question in the in-app assistant; payload holds the message, the assistant reply, the page context, and whether it was feedback or a question.',
   false)
ON CONFLICT (id) DO NOTHING;
