-- =============================================================================
-- Vertical migration 0084: Matter tasks (with optional billing)
--
-- Beta feedback (6b968a24, 61bed38b): the attorney wants ad-hoc TASKS on a matter
-- — beyond the derived Intake -> Consultation -> Document workflow steps — each
-- optionally carrying a cost (hours, or a fixed fee).
--
-- Billing model (append-only-safe, per Joe: "auto-bill on done; moving it back
-- un-bills it"): a task is the LIVE SOURCE of its charge. A task that is `done`
-- + costed + not-yet-invoiced shows up as an UNBILLED line on its matter
-- (computed from the task's current state — so moving it back out of `done`
-- simply removes the line again; nothing is deleted). Putting it on an invoice
-- sets task_invoice_id, which LOCKS it (it stops being unbilled and can no longer
-- be un-billed by moving it back). No void/reversal events, no in-place edits of
-- history.
--
-- A task is an ENTITY with its own lifecycle (create / update via append-only
-- attribute supersession / archive via the core entity.archive action), linked to
-- its matter by a `task_of` relationship. Status and billing_mode are attribute
-- VALUES, not new kinds.
--
-- Id block 0900 (entity 1010, attribute 1011, relationship 1012, action 1013):
-- verified free on origin/main migration files (max 08xx) AND the live DB (max
-- 07xx). Matter entity kind = 1010-...0001. Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── task entity kind ─────────────────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000900', '00000000-0000-0000-0000-000000000001',
   'task', 'Task',
   'An ad-hoc to-do on a matter, optionally costed (hours or a fixed fee).',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── task attributes ──────────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000900', '00000000-0000-0000-0000-000000000001',
   'task_title', 'Title', 'What needs doing.',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000901', '00000000-0000-0000-0000-000000000001',
   'task_status', 'Status', 'open | in_progress | blocked | done.',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000902', '00000000-0000-0000-0000-000000000001',
   'task_due_date', 'Due date', 'Optional ISO date (YYYY-MM-DD) the task is due.',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000903', '00000000-0000-0000-0000-000000000001',
   'task_assignee_actor_id', 'Assignee',
   'Optional firm member (actor id) the task is assigned to.',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000904', '00000000-0000-0000-0000-000000000001',
   'task_billing_mode', 'Billing mode',
   'none | hours | fixed — how the task bills when it is done.',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000905', '00000000-0000-0000-0000-000000000001',
   'task_hours', 'Hours', 'Billable hours (decimal string) when billing_mode = hours.',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000906', '00000000-0000-0000-0000-000000000001',
   'task_fee_amount', 'Fixed fee', 'Flat fee amount when billing_mode = fixed.',
   '00000000-0000-0000-1010-000000000900', 'money', false),
  ('00000000-0000-0000-1011-000000000907', '00000000-0000-0000-0000-000000000001',
   'task_invoice_id', 'Billed on invoice',
   'Set to the invoice entity id when the task cost is placed on an invoice — locks it.',
   '00000000-0000-0000-1010-000000000900', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── task_of relationship (task -> matter) ────────────────────────────────────
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000900', '00000000-0000-0000-0000-000000000001',
   'task_of', 'Task of', 'A task belongs to a matter.',
   '00000000-0000-0000-1010-000000000900', '00000000-0000-0000-1010-000000000001',
   'many_to_one', 'directed', 'has_task')
ON CONFLICT (id) DO NOTHING;

-- ── task lifecycle actions (all writes go through these handlers) ─────────────
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000900', '00000000-0000-0000-0000-000000000001',
   'legal.task.create', 'Create task', 'Create a task on a matter.',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000901', '00000000-0000-0000-0000-000000000001',
   'legal.task.update', 'Update task',
   'Update a task (status, fields, billing) via append-only attribute supersession.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
