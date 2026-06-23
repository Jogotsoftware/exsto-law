-- =============================================================================
-- Vertical migration 0094: legal.service.set_lifecycle (ADR 0045, PR4a)
--
-- Registers the action kind that AUTHORS a workflow graph onto a service's
-- workflow_definition.states:
--
--   legal.service.set_lifecycle (action) — replace the active service version's
--       lifecycle STATES with a new, validated stage graph (a Lifecycle: ordered
--       LifecycleStage[]). Like every service edit it is VERSIONED, never an
--       in-place edit: the handler seals the prior active workflow_definition row
--       (valid_to = now(), status = 'deprecated') and inserts version+1, carrying
--       display_name / description / transitions / participating_entity_kinds
--       forward UNCHANGED while replacing states with the authored graph. It also
--       appends a configuration_change row (invariant 18). This is what the matter
--       Workflow builder saves and what the SMLLC author script uses to put the
--       founder's 5-step workflow onto the NC SMLLC service.
--
-- How this differs from legal.service.upsert: upsert is the metadata/transitions
-- editor — it CARRIES states FORWARD untouched. set_lifecycle is the inverse: it
-- WRITES states (the lifecycle graph) and carries everything else forward.
--
-- autonomy 'notify': a graph save is a low-stakes config edit (the attorney sees
--   it land). reversibility 'fully_reversible': a new version supersedes, and a
--   prior version can be re-authored back. requires_reasoning_trace = false: a
--   manual builder save needs no trace; the PR5 AI authoring path attaches one
--   voluntarily.
--
-- Id (deterministic, idempotent ON CONFLICT (id) DO NOTHING):
--   action_kind_definition  legal.service.set_lifecycle
--     00000000-0000-0000-1013-000000000a02  (the a0x block is the workflow
--     engine's; a01 = legal.matter.advance in 0093, a02 verified free).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000a02', '00000000-0000-0000-0000-000000000001',
   'legal.service.set_lifecycle', 'Author service workflow lifecycle',
   'Author the lifecycle stage graph onto a service''s workflow_definition.states (ADR 0045). Versioned: seals the prior active service version and inserts version+1, replacing states with the validated graph while carrying display_name/description/transitions/participating_entity_kinds forward unchanged. The matter Workflow builder save path (and the SMLLC author script) use this.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
