-- =============================================================================
-- Vertical migration 0017: assistant.turn event kind
--
-- The unified assistant chat replaces the per-matter "Ask Perplexity" research
-- panel and the global beta-feedback chat with ONE chat bot the attorney can
-- point at any connected AI model (Claude, Perplexity, …) and that automatically
-- picks up the matter/client they are on. Every exchange is recorded as an
-- assistant.turn event so the conversation is auditable substrate data, not
-- browser-only state.
--
-- One event kind for all three intents (question / research / feedback): the
-- payload carries `provider`, `model`, `kind`, `citations`, and a `scope` tag.
-- A matter- or contact-scoped turn sets primary_entity_id to that entity (so it
-- threads on the matter timeline); a global turn (beta feedback from the FAB)
-- leaves primary_entity_id NULL. Supersedes research.recorded (0007) and
-- feedback.recorded (0008), which stay defined for historical rows.
--
-- Configuration-as-data: a new event kind is a row, not code. Not a state change
-- (it observes; it does not transition a matter). Data-only; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-00000000000c', '00000000-0000-0000-0000-000000000001',
   'assistant.turn', 'Assistant turn',
   'One exchange in the unified assistant chat: payload holds the attorney message, the assistant reply, the provider and model used, the classified kind (question/research/feedback), any citations, and the scope (matter/contact/global). Matter- and contact-scoped turns set primary_entity_id; global turns leave it null.',
   false)
ON CONFLICT (id) DO NOTHING;
