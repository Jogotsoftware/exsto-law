-- =============================================================================
-- Vertical migration 0021: Assign a call to a matter (beta sprint Objective 8)
--
-- Granola-ingested calls that don't auto-match a matter land in the review queue
-- (call_sessions with no call_of). This action lets the attorney route one to a
-- matter from that queue: it adds the call_of relationship (call_session → matter)
-- through the action layer, so the call then appears on the matter's (and the
-- contact's) calls list. Linking only — it deliberately does NOT mutate
-- matter_status, so assigning a call to an already-advanced matter can't regress
-- its stage.
--
-- Definition only (configuration-as-data). The relationship kind call_of already
-- exists (WP1 seed); no new relationship/entity/attribute kind is needed. Next
-- free action id verified against the live pilot DB (action_kind ≤ 0020). Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000021', '00000000-0000-0000-0000-000000000001',
   'legal.call.assign', 'Assign call to matter', 'Attach an ingested call to a matter (adds call_of) from the review queue.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
