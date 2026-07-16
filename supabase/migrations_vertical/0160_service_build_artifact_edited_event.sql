-- =============================================================================
-- Vertical migration 0160: service_build.artifact_edited event kind
-- (BUILDER-UX-1 WP-4 — the edit-in-place trail)
--
-- When the attorney EDITS a wizard-proposed artifact in the pop-up editor before
-- approving it, we record a first-class event on the build session so the
-- transcript is honest: proposal → HUMAN EDIT → approval. Until now no
-- proposal/edit event kind existed, so an edit left no trail. This is the
-- dedicated kind (HARDENING-RESIDUALS-1 recorded human edits as a generic
-- `observation` with a tag; BUILDER-UX-1 promotes it to its own queryable kind).
--
-- Payload: { artifact_type (service|questionnaire|template|workflow|billing),
--            service_key, summary }. Primary entity = the service_build_session.
--
-- Definition only (configuration-as-data); event kinds CAN be minted by
-- kind.define, but this session's doctrine lands new kinds as migrations. Id
-- block 1014-…1000 — fresh, verified above the live frontier (…0f03) and main.
-- BUILDER-UX-1 lease is 0160–0169. Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000001000', '00000000-0000-0000-0000-000000000001',
   'service_build.artifact_edited', 'Build artifact edited by attorney',
   'The attorney hand-edited a wizard-proposed artifact in the pop-up editor before approving it. Payload: artifact_type (service|questionnaire|template|workflow|billing), service_key, summary. Primary entity = the service_build_session, so the build transcript reads proposal → human edit → approval.',
   false)
ON CONFLICT (id) DO NOTHING;
