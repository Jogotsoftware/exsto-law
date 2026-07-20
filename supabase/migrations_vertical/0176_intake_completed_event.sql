-- =============================================================================
-- 0176 — intake.completed event kind (WF-FIX-1 WP2)
--
-- "The client completes the intake questionnaire" had NO lifecycle event: the
-- only system tokens a workflow edge could wait on were invoice.paid /
-- esign.completed / transcript.received, so builders modeling an intake step
-- reached for transcript.received (the only intake-adjacent-sounding option) and
-- stranded matters at stages no form submission could ever exit (the live
-- Pacheco single_member_llc_operating_agreement repro). matter.open and
-- legal.questionnaire.submit now emit intake.completed and dispatch it into the
-- workflow engine (dispatchLifecycleEvent), so a system edge `on:
-- 'intake.completed'` fires the moment intake lands.
--
-- is_state_change=false: the state change is workflow.advanced's (emitted by the
-- engine when the edge fires); this event is the SIGNAL, not the transition.
--
-- Ids: event family ...1014, FRESH ...22xx sub-block (max in-repo was ...2100 —
-- parallel-batch rule: fresh sub-block per branch, never adjacent increments).
-- Idempotent; the 0174 vocab sweep (cp_sync_all_tenant_vocab) propagates the
-- kind to every tenant on the next migrate:vertical pass.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000002200', '00000000-0000-0000-0000-000000000001',
   'intake.completed', 'Intake completed',
   'The client completed the intake questionnaire for a matter. Emitted by matter.open (public funnel: intake precedes open) and by legal.questionnaire.submit (intake attached to an existing matter). Primary=matter; payload holds service_key / questionnaire linkage. Workflow edges gated system on:intake.completed fire on this signal.',
   false)
ON CONFLICT (id) DO NOTHING;

-- Per-tenant propagation: migrate-vertical.mjs runs private.cp_sync_all_tenant_vocab()
-- after every pass (0174), so no explicit per-tenant copies here.
