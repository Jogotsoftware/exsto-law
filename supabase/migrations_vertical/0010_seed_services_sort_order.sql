-- =============================================================================
-- Vertical migration 0010: backfill service sort_order into transitions
--
-- The booking page's stable service order used to live in a hardcoded
-- SERVICE_ORDER map in services.ts. PR1 moves it into config-as-data:
-- transitions.sort_order on each service's workflow_definition row. This
-- backfill seeds the three Phase-0 services with the SAME order the map had
-- (single=0, multi=1, something_else=2).
--
-- ADDITIVE + idempotent: jsonb_set only ADDS the sort_order key; route,
-- intake_form_id, documents, on_transcript and notify are preserved VERBATIM.
-- In particular the single-member row keeps route='auto' + on_transcript=
-- 'draft.generate', which the auto-drafting gate (generateDraft) depends on.
-- Only touches the CURRENT active row of each service (valid_to IS NULL).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

UPDATE workflow_definition
   SET transitions = jsonb_set(transitions, '{sort_order}', '0'::jsonb, true)
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
   AND kind_name = 'nc_llc_single_member'
   AND valid_to IS NULL;

UPDATE workflow_definition
   SET transitions = jsonb_set(transitions, '{sort_order}', '1'::jsonb, true)
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
   AND kind_name = 'nc_llc_multi_member'
   AND valid_to IS NULL;

UPDATE workflow_definition
   SET transitions = jsonb_set(transitions, '{sort_order}', '2'::jsonb, true)
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
   AND kind_name = 'something_else'
   AND valid_to IS NULL;

SELECT public.sync_migration_history();
