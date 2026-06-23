-- =============================================================================
-- Vertical migration 0093: configurable workflow ENGINE (ADR 0045, PR3 write path)
--
-- Registers the two kinds the engine's write path needs and hardens
-- workflow_instance so its history cannot be rewritten:
--
--   legal.matter.advance  (action) — advance ONE matter one step through its bound
--                                     lifecycle. Manual gate path (attorney/client
--                                     "Continue"/approve) and the action wrapper a
--                                     system callback uses. Mirrors matter_status +
--                                     emits workflow.advanced. autonomy 'notify',
--                                     reversibility 'reversible_with_state_decay'
--                                     (a future legal.matter.revert can step back;
--                                     no reverse handler in PR3), no reasoning trace.
--   workflow.advanced     (event)  — a matter advanced from one stage to another;
--                                     is_state_change=true. payload: {from, to, gate,
--                                     trigger}. PRIMARY = matter.
--
-- ADR-0045 MIRROR DEVIATION (documented): the legal vertical does NOT re-register
-- the foundation workflow.start / workflow.advance primitives. Its instance writer
-- (verticals/legal/src/lifecycle/instance.ts) mirrors their INSERT/UPDATE SQL shape
-- but appends RICHER state_history entries ({state, from, gate, via, action_id, at})
-- than the primitive's ({state, action_id}). Same table, same append-only law,
-- one extra structured field per hop — the engine needs to know HOW each hop fired.
--
-- workflow_instance is the ADR-0039 EXCEPTION: a lifecycle table whose status +
-- current_state mutate in place. But its state_history must remain APPEND-ONLY (the
-- audit stream of how the matter moved). The two BEFORE UPDATE triggers below
-- enforce that at the DB layer (defense in depth, like migration 0017):
--   (a) state_history may only GROW, and OLD must stay a positional PREFIX of NEW;
--   (b) workflow_definition_id is immutable (invariant 17: a matter never re-binds
--       to a different definition after it is opened).
--
-- Ids used (deterministic, idempotent ON CONFLICT (id) DO NOTHING):
--   action_kind_definition  legal.matter.advance  00000000-0000-0000-1013-000000000a01
--   event_kind_definition   workflow.advanced     00000000-0000-0000-1014-000000000a01
-- (The a01 suffix in the 1013/1014 blocks was unused.)
--
-- Adds workflow_instance.states_override jsonb (nullable): a per-instance graph
-- override that supersedes the bound version's states for ONE matter (PR4 "edit this
-- matter's steps"); null for the normal case.
--
-- Day-one: nothing reaches these without LEGAL_WORKFLOW_ENGINE=1; flag OFF is a
-- perfect no-op. No history-sync call (matches the vertical-migration style).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── Kinds (schema-as-data) ───────────────────────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000a01', '00000000-0000-0000-0000-000000000001',
   'legal.matter.advance', 'Advance matter through workflow',
   'Advance one matter one step through its bound lifecycle (ADR 0045). Manual gate path (attorney/client continue/approve) and the wrapper a system callback uses. Mirrors matter_status and emits workflow.advanced. Guarded against the bound graph: an illegal transition is rejected.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000a01', '00000000-0000-0000-0000-000000000001',
   'workflow.advanced', 'Workflow advanced',
   'A matter advanced from one lifecycle stage to another (ADR 0045). payload holds {from, to, gate, trigger}. Primary=matter.',
   true)
ON CONFLICT (id) DO NOTHING;

-- ── Per-instance graph override (PR4 "edit this matter's steps") ──────────────
ALTER TABLE workflow_instance ADD COLUMN IF NOT EXISTS states_override jsonb;

-- ── (a) state_history is append-only by positional prefix ────────────────────
-- NEW.state_history must be at least as long as OLD's, and the first
-- jsonb_array_length(OLD) elements of NEW must equal OLD element-wise. Any rewrite,
-- shortening, or reordering of recorded history RAISES. SECURITY INVOKER (default)
-- + empty search_path; only pg_catalog built-ins are used (always resolvable).
CREATE OR REPLACE FUNCTION public.workflow_instance_history_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  old_len integer := pg_catalog.jsonb_array_length(COALESCE(OLD.state_history, '[]'::jsonb));
  new_len integer := pg_catalog.jsonb_array_length(COALESCE(NEW.state_history, '[]'::jsonb));
  i integer;
BEGIN
  IF new_len < old_len THEN
    RAISE EXCEPTION 'append-only violation: workflow_instance.state_history shrank (% -> %) (ADR 0045)',
      old_len, new_len USING ERRCODE = 'restrict_violation';
  END IF;
  FOR i IN 0 .. old_len - 1 LOOP
    IF (OLD.state_history -> i) IS DISTINCT FROM (NEW.state_history -> i) THEN
      RAISE EXCEPTION 'append-only violation: workflow_instance.state_history element % was rewritten (ADR 0045)',
        i USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS workflow_instance_history_append_only ON workflow_instance;
CREATE TRIGGER workflow_instance_history_append_only
  BEFORE UPDATE ON workflow_instance
  FOR EACH ROW EXECUTE FUNCTION public.workflow_instance_history_append_only();

-- ── (b) workflow_definition_id is immutable (invariant 17) ───────────────────
CREATE OR REPLACE FUNCTION public.workflow_instance_definition_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.workflow_definition_id IS DISTINCT FROM OLD.workflow_definition_id THEN
    RAISE EXCEPTION 'immutability violation: workflow_instance.workflow_definition_id cannot change (% -> %) (invariant 17)',
      OLD.workflow_definition_id, NEW.workflow_definition_id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS workflow_instance_definition_immutable ON workflow_instance;
CREATE TRIGGER workflow_instance_definition_immutable
  BEFORE UPDATE ON workflow_instance
  FOR EACH ROW EXECUTE FUNCTION public.workflow_instance_definition_immutable();
