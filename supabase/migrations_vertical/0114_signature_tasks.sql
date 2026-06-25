-- =============================================================================
-- Vertical migration 0114: Signature tasks
--
-- A "signature task" is the bridge between the matter TASK primitive (0084) and
-- the native e-signature ENVELOPE (0043/0044). The attorney attaches a document
-- to a task; opening that task IS the DocuSign-style experience (prepare & send →
-- track signatures/countersignatures → review the executed copy). The task cannot
-- reach `done` until the envelope is `completed` AND the attorney has reviewed it.
--
-- This adds to the existing `task` entity (no new entity kind):
--   • task_kind                 todo | signature  — which experience a task opens
--   • task_document_version_id  the document_version attached for signing
--   • task_esign_envelope_id    the envelope, once sent (append-only supersession
--                               lets a declined task be re-sent — newest wins)
--   • task_reviewed_at          when the attorney reviewed the executed copy (the
--                               gate: status can only go `done` once this is set)
--   • task_document             relationship task -> document entity
--   • legal.task.attach_document / .link_envelope / .review  — the new writes
--
-- Status `done` for a signature task is reached only via legal.task.review, which
-- the API gates on envelope `completed`. The plain-task statuses are unchanged.
--
-- Id block d0 (attribute 1011, relationship 1012, action 1013): renumbered from
-- 0113/c0 after Stripe Connect (#266) landed on main as 0113 using the c0 block —
-- d0 is free on origin/main; numbered 0114, above main's max (0113).
-- Task entity kind = 1010-...0900; document entity kind = 1010-...0006.
-- Configuration-as-data; idempotent (ON CONFLICT (id) DO NOTHING).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── signature-task attributes (on the existing `task` entity) ────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000d00', '00000000-0000-0000-0000-000000000001',
   'task_kind', 'Task kind',
   'todo | signature — a signature task opens the e-signature experience.',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000d01', '00000000-0000-0000-0000-000000000001',
   'task_document_version_id', 'Attached document',
   'The document_version attached to the task for signing.',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000d02', '00000000-0000-0000-0000-000000000001',
   'task_esign_envelope_id', 'Signature envelope',
   'The signature_envelope created when the task was sent for signature (newest wins on re-send).',
   '00000000-0000-0000-1010-000000000900', 'text', false),
  ('00000000-0000-0000-1011-000000000d03', '00000000-0000-0000-0000-000000000001',
   'task_reviewed_at', 'Reviewed at',
   'When the attorney reviewed the executed copy. The gate before status can go done.',
   '00000000-0000-0000-1010-000000000900', 'datetime', false)
ON CONFLICT (id) DO NOTHING;

-- ── task_document relationship (task -> document) ────────────────────────────
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000d00', '00000000-0000-0000-0000-000000000001',
   'task_document', 'Task document', 'A task carries a document to be signed.',
   '00000000-0000-0000-1010-000000000900', '00000000-0000-0000-1010-000000000006',
   'many_to_one', 'directed', 'document_task')
ON CONFLICT (id) DO NOTHING;

-- ── signature-task lifecycle actions (all writes go through these handlers) ───
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000d00', '00000000-0000-0000-0000-000000000001',
   'legal.task.attach_document', 'Attach document to task',
   'Attach a document to a task for signing — marks it a signature task.',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000d01', '00000000-0000-0000-0000-000000000001',
   'legal.task.link_envelope', 'Link signature envelope',
   'Record the signature envelope a task was sent under (set after send_for_signature).',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000d02', '00000000-0000-0000-0000-000000000001',
   'legal.task.review', 'Review executed signature',
   'The attorney reviewed the executed copy after all parties signed; completes the task.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
