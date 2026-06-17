-- =============================================================================
-- Vertical migration 0019: fix colliding event-kind ids for assistant.turn +
-- time.logged
--
-- Migrations 0017 (assistant.turn) and 0018 (time.logged + expense.recorded)
-- assigned event-kind ids ...000c and ...000d — but those were ALREADY taken by
-- 0015 (client portal messaging: attorney.message.sent = ...000c,
-- client.message.received = ...000d). Because 0017/0018 used
-- `ON CONFLICT (id) DO NOTHING`, the assistant.turn and time.logged rows were
-- silently skipped on every database that had 0015 applied — so those two kinds
-- never got created, and event.record for them fails. (expense.recorded landed
-- on the free id ...000e and is fine.)
--
-- 0017/0018 are already applied + recorded in the ledger, so they are immutable
-- (forward-only). This corrective migration creates the two missing kinds on the
-- next FREE ids (...000f, ...0010). It is idempotent and collision-proof: each
-- insert is guarded by NOT EXISTS on the kind_name, so it is a no-op on any
-- database where the kind already exists (under any id).
--
-- Data-only; not a state change.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT '00000000-0000-0000-1014-00000000000f', '00000000-0000-0000-0000-000000000001',
       'assistant.turn', 'Assistant turn',
       'One exchange in the unified assistant chat: payload holds the attorney message, the assistant reply, the provider and model used, the classified kind (question/research/feedback), any citations, and the scope (matter/contact/global). Matter- and contact-scoped turns set primary_entity_id; global turns leave it null.',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM event_kind_definition
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND kind_name = 'assistant.turn'
);

INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT '00000000-0000-0000-1014-000000000010', '00000000-0000-0000-0000-000000000001',
       'time.logged', 'Time logged',
       'An attorney logged billable time against a matter; payload holds duration_minutes, description, and the worked date.',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM event_kind_definition
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND kind_name = 'time.logged'
);
