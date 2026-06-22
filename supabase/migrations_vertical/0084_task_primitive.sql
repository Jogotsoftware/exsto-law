-- =============================================================================
-- Vertical migration 0084: the task primitive (matter to-dos)
--
-- A matter accumulates work items. Until now there was no first-class "task"
-- concept; this registers one as schema-as-data (ADR 0012) so tasks can be
-- created, assigned, and (later) billed without any code knowing a hardcoded
-- "task" type. DEFINITIONS ONLY — no UI, no lifecycle engine, no resolver logic.
--
--   • entity kind   task
--   • attributes    task_status (enum todo|in_progress|blocked|done),
--                   task_assignee (text), task_billable (boolean),
--                   task_rate (money). The existing `due_date` (datetime, 0008)
--                   is REUSED — not duplicated — for a task's due date.
--   • relationship  task_of  (task -> matter, many_to_one, inverse has_task)
--   • actions       legal.task.create / legal.task.update / legal.task.complete
--
-- Ids use the 0800 block, verified free on prod AND clear of the parallel
-- migrations (0082 document-upload took the 0700 block; billing took 04xx/05xx):
-- entity 1010-…0800, attribute 1011-…0800..0803, relationship 1012-…0800,
-- action 1013-…0800..0802. Configuration-as-data; idempotent (fixed ids +
-- ON CONFLICT DO NOTHING); no schema change.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- Entity kind: task -----------------------------------------------------------
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000800', '00000000-0000-0000-0000-000000000001',
   'task', 'Task',
   'A unit of work on a matter (a to-do). Carries a status, an optional assignee and due date, and whether it is billable. Tasks attach to a matter via task_of.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- Task attributes -------------------------------------------------------------
-- (due_date is reused from migration 0008, not redefined here.)
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii, validation) VALUES
  ('00000000-0000-0000-1011-000000000800', '00000000-0000-0000-0000-000000000001',
   'task_status', 'Task status',
   'todo | in_progress | blocked | done — the task''s current state.',
   '00000000-0000-0000-1010-000000000800', 'enum', false,
   '{"enum":["todo","in_progress","blocked","done"]}'),
  ('00000000-0000-0000-1011-000000000801', '00000000-0000-0000-0000-000000000001',
   'task_assignee', 'Task assignee',
   'Who the task is assigned to (free text — a name or actor reference; a typed actor link can supersede this later).',
   '00000000-0000-0000-1010-000000000800', 'text', false, '{}'),
  ('00000000-0000-0000-1011-000000000802', '00000000-0000-0000-0000-000000000001',
   'task_billable', 'Task billable',
   'Whether work on this task is billable to the client.',
   '00000000-0000-0000-1010-000000000800', 'boolean', false, '{}'),
  ('00000000-0000-0000-1011-000000000803', '00000000-0000-0000-0000-000000000001',
   'task_rate', 'Task rate',
   'Per-task billable rate override, a decimal money value (ADR 0044). Absent = fall back to the client/firm rate (rate resolution is deferred, owned by Contract K).',
   '00000000-0000-0000-1010-000000000800', 'money', false, '{}')
ON CONFLICT (id) DO NOTHING;

-- Relationship: task -> matter ------------------------------------------------
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000800', '00000000-0000-0000-0000-000000000001',
   'task_of', 'Task of matter', 'A task belongs to a matter.',
   '00000000-0000-0000-1010-000000000800', '00000000-0000-0000-1010-000000000001',
   'many_to_one', 'directed', 'has_task')
ON CONFLICT (id) DO NOTHING;

-- Action kinds ----------------------------------------------------------------
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000800', '00000000-0000-0000-0000-000000000001',
   'legal.task.create', 'Create task',
   'Create a task on a matter (status, optional assignee/due date/billable). Reversible by archiving the task entity.',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000801', '00000000-0000-0000-0000-000000000001',
   'legal.task.update', 'Update task',
   'Update a task''s status, assignee, due date, or billing fields (a new version supersedes the prior state).',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000802', '00000000-0000-0000-0000-000000000001',
   'legal.task.complete', 'Complete task',
   'Mark a task done (sets task_status = done). Reversible by re-opening the task.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
