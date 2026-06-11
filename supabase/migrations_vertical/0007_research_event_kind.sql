-- =============================================================================
-- Vertical migration 0007: research.recorded event kind
--
-- Perplexity research in the attorney workspace is recorded on the matter
-- timeline like every other thing that happens to a matter (Granola calls,
-- drafts). Each query+answer becomes a research.recorded event with provenance
-- integration:perplexity. Configuration-as-data: a new event kind is a row,
-- not code. Data-only; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-00000000000a', '00000000-0000-0000-0000-000000000001',
   'research.recorded', 'Research recorded',
   'An attorney ran a Perplexity research query against this matter; payload holds the question, answer, citations, and model.',
   false)
ON CONFLICT (id) DO NOTHING;
