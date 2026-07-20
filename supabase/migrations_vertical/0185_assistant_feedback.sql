-- =============================================================================
-- Vertical migration 0185: assistant.feedback_submitted event kind (FB-0)
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR. The
-- orchestrator session applies it after review, per the rebase-train protocol.
--
-- FOUNDER ASK: thumbs up/down on any assistant reply (attorney chat AND the
-- client-portal chat), a tiny modal for an optional note, and the WHOLE
-- visible chat + the note saved for the team to review. This is a DIFFERENT,
-- narrower signal than the existing beta-feedback channel (assistant.turn,
-- kind='feedback', legal.assistant.feedback_* — free-text product feedback
-- about the app). A message-level quality rating on ONE specific reply is its
-- own event so the two channels never conflate; see verticals/legal/src/api/
-- assistantMessageFeedback.ts for the write/read path.
--
-- Payload: verdict ('up'|'down'), note (nullable, attorney/client-authored),
-- surface ('attorney'|'portal'), message_event_id (the rated assistant.turn's
-- eventId, nullable — the portal surface does not yet return per-turn event
-- ids to the client), message_index (0-based position of the rated message in
-- the visible transcript, always present), matter_entity_id / contact_entity_id
-- (nullable scope refs, mirrors assistant.turn), chat_session_id /
-- build_session_id (nullable), full_transcript_blob_id (a content_blob holding
-- the WHOLE visible conversation as JSON at submit time — transcripts can
-- rival a document in size, so NEVER inlined here, same discipline as 0183's
-- ops_blob_id), transcript_turn_count (denormalized for list views),
-- client_contact_id (portal submissions only, stamped server-side from the
-- session — never client-asserted). Primary entity = the matter/contact the
-- chat was scoped to, when any; null for a global/unscoped attorney chat.
--
-- is_state_change = false: a signal/audit record (like document.redlined),
-- not itself a lifecycle transition.
--
-- Ids: fresh …2100 sub-block in the 1014 (event_kind) band — free against
-- every migrations_vertical file up to and including 0184 (2200/2210/2220/3000
-- already taken by 0176/0177/0183/0184).
--
-- Multi-tenant: explicit all-tenants catch-up loop (0184's idiom), gated on
-- tenants that already have the assistant.turn event kind (i.e. already run
-- the legal vertical's assistant chat) — belt-and-braces alongside the
-- automatic private.cp_sync_all_tenant_vocab() (0174) pass migrate-vertical.mjs
-- runs after every migration file.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── event kind (tenant-zero, fixed id) ───────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000002100', '00000000-0000-0000-0000-000000000001',
   'assistant.feedback_submitted', 'Assistant message feedback submitted',
   'A thumbs up/down rating (with an optional note) on ONE specific assistant reply, from the attorney chat or the client portal chat. Payload: verdict (up|down), note (nullable), surface (attorney|portal), message_event_id (nullable — the rated assistant.turn''s event id, when known), message_index (0-based position in the visible transcript), matter_entity_id, contact_entity_id, chat_session_id, build_session_id (all nullable scope refs), full_transcript_blob_id (a content_blob holding the WHOLE visible conversation as JSON — never inlined), transcript_turn_count, client_contact_id (portal submissions only, server-stamped). Primary entity is the matter/contact the chat was scoped to, when any. Distinct from the assistant.turn kind=''feedback'' beta-feedback channel — this rates one reply''s quality, not the product.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: every OTHER tenant that already has the assistant.turn event
-- kind (i.e. already runs the legal vertical's assistant chat). Skips
-- tenant-zero (already covered above) and any tenant that somehow already has
-- the kind (re-run safe).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM event_kind_definition
    WHERE kind_name = 'assistant.turn'
      AND (valid_to IS NULL OR valid_to > now())
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    IF NOT EXISTS (
      SELECT 1 FROM event_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'assistant.feedback_submitted'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO event_kind_definition
        (id, tenant_id, kind_name, display_name, description, is_state_change)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'assistant.feedback_submitted', 'Assistant message feedback submitted',
         'A thumbs up/down rating (with an optional note) on ONE specific assistant reply, from the attorney chat or the client portal chat. Payload: verdict (up|down), note (nullable), surface (attorney|portal), message_event_id (nullable — the rated assistant.turn''s event id, when known), message_index (0-based position in the visible transcript), matter_entity_id, contact_entity_id, chat_session_id, build_session_id (all nullable scope refs), full_transcript_blob_id (a content_blob holding the WHOLE visible conversation as JSON — never inlined), transcript_turn_count, client_contact_id (portal submissions only, server-stamped). Primary entity is the matter/contact the chat was scoped to, when any. Distinct from the assistant.turn kind=''feedback'' beta-feedback channel — this rates one reply''s quality, not the product.',
         false);
    END IF;
  END LOOP;
END $$;

SELECT public.sync_migration_history();
