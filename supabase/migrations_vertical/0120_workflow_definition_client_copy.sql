-- =============================================================================
-- Vertical migration 0120: client-facing display copy on workflow_definition.
--
-- UI-BUILDER-FIX-1 Phase 1. Service offerings carry TWO display layers:
--   display_name / description              — attorney-facing (jurisdiction- and
--                                             process-specific; unchanged)
--   client_display_name / client_description — client-facing, outcome-only copy
--                                             for the public intake tiles
--                                             (<=70 chars, no jurisdiction/process)
--
-- Both nullable, NO backfill: guessing client copy for live services is worse
-- than falling back. The read path (listServices) falls back to
-- display_name/description ONLY when the client fields are null, so nothing
-- goes blank. Copy for the live services ships separately, approval-gated.
--
-- Versioning: workflow_definition is versioned (seal + insert v+1). The write
-- handlers (legal.service.upsert / legal.service.set_lifecycle) carry both
-- client fields forward to every new version unless a proposal explicitly
-- changes them — enforced in code + tested, not here.
--
-- Migration 0120 is above main+prod max (0119). Columns only, no new kinds.
-- Idempotent.
-- =============================================================================

ALTER TABLE workflow_definition ADD COLUMN IF NOT EXISTS client_display_name text;
ALTER TABLE workflow_definition ADD COLUMN IF NOT EXISTS client_description text;

COMMENT ON COLUMN workflow_definition.client_display_name IS
  'Client-facing service name for the public intake tiles: outcome-only, no jurisdiction, <=70 chars. Null = fall back to display_name.';
COMMENT ON COLUMN workflow_definition.client_description IS
  'Client-facing one-liner for the public intake tiles: what the client receives, <=70 chars, never process/jurisdiction. Null = fall back to description.';
