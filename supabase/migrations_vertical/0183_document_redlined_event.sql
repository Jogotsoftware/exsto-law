-- =============================================================================
-- 0183 — document.redlined event kind (B2.3 — SAVE-REDLINES-1)
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR. The
-- orchestrator session applies it after review, per the rebase-train protocol
-- (ui-fixes-for-exsto-lexical-starlight.md).
--
-- The tracked-changes editor (li-edtr) already computes rich per-hunk redline
-- structure — origin (manual/ai), the AI instruction, accept/reject per hunk —
-- but Save (legal.draft.edit → document.edit) collapsed all of it into a
-- summary note string, discarding per-hunk data and every REJECTED suggestion.
-- The document.edit handler (verticals/legal/src/handlers/draft.ts) now emits
-- this event alongside the new document_version whenever the save carries the
-- new redline group (`source` present — i.e. it came from the tracked-changes
-- editor, not a bare programmatic edit): payload = {from_version_id,
-- to_version_id, editor_actor_id, source: human|ai_accepted|mixed,
-- ops_blob_id (a content_blob — the ops can rival the document body in size,
-- never inlined), instruction_text, reasoning_trace_id, counts{accepted,
-- rejected,ai,manual}}. primary_entity_id is the MATTER (draft_of/
-- comm_draft_of target) — the same scoping draft.completed/document_fee.
-- recorded use — secondary_entity_ids carries the document entity.
--
-- is_state_change=false: this is a signal/audit record, not itself a lifecycle
-- transition (the document_version row is the state; this event narrates HOW
-- it changed).
--
-- Tenant-zero only: private.cp_sync_all_tenant_vocab() (0174) propagates this
-- to every other tenant automatically on the next `pnpm migrate:vertical` pass
-- — the current convention (see 0176's header), not a per-migration loop.
--
-- Ids: event family ...1014. Existing sub-blocks: ...2200 (0176 intake.
-- completed), ...2210 (0177 matter.repin). FRESH ...2220 (parallel-batch rule:
-- fresh sub-block per branch, never adjacent increments).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000002220', '00000000-0000-0000-0000-000000000001',
   'document.redlined', 'Document redlined',
   'A document.edit save that came from the tracked-changes editor (as opposed to a bare programmatic edit). Payload: from_version_id, to_version_id, editor_actor_id, source (human|ai_accepted|mixed), ops_blob_id (a content_blob holding the full per-hunk accept/reject log — never inlined), instruction_text (the AI revision instruction(s), if any), reasoning_trace_id (the accepted AI revision''s trace, de-orphaned), and counts{accepted,rejected,ai,manual}. Primary entity is the matter; the document entity rides secondary_entity_ids. The Service Digest (buildServiceDigestEvidence) reads this structured-first, falling back to the legacy "AI revision: " note-string prefix.',
   false)
ON CONFLICT (id) DO NOTHING;

-- Per-tenant propagation: migrate-vertical.mjs runs private.cp_sync_all_tenant_vocab()
-- after every pass (0174), so no explicit per-tenant copies here.
