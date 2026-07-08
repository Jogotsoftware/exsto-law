-- =============================================================================
-- Vertical migration 0118: capability.invoked event kind (ADR 0046 runtime)
--
-- The audit receipt that the workflow engine RAN a step-invocable capability:
-- api/capabilityRuntime.invokeCapabilityForMatter records one `capability.invoked`
-- event per successful run, primary=matter, payload = { capability_slug,
-- handler_key, stage, gate, summary, outputs[] }. is_state_change=false — the
-- invocation itself does not move matter_status (the capability's GATE does, via
-- draft.approve / a client delivery / an automatic advance).
--
-- FAILURES do NOT get a new kind: a contracted-but-unimplemented capability, a
-- missing required input, or a non-invocable slug records the core-seeded
-- `observation` kind (tag capability_not_executable / capability_invoke_failed),
-- so no migration is needed for the negative paths.
--
-- Everything else the runtime needs already exists: the review memo reuses
-- draft.generate/document_draft/draft_of + document.review.* (0116); the client
-- materials request reuses attorney.message.post + client.message.received; client
-- deliveries reuse document.uploaded (0082) + booking's consultation.booked.
--
-- event_kind_definition is TENANT-SCOPED (RLS) and event.record throws
-- "Kind not found" when the row is absent for the acting tenant, so the kind must
-- exist for EVERY legal tenant — same "seed for every firm" pattern as 0113/0115/
-- 0116 (firm_settings = the per-tenant legal marker). Id block 1019 (fresh —
-- 1000/1010-1014/1016/1017/1018/1020/1030 taken; verified 0 capability.invoked in
-- prod before applying). Migration number 0118 is above main+prod max (0117).
-- =============================================================================

-- ── Tenant zero (Pacheco pilot) — fixed id, idempotent ────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1019-000000000001', '00000000-0000-0000-0000-000000000001',
   'capability.invoked', 'Platform capability invoked',
   'The workflow engine ran a step-invocable capability as an invoke_capability step. Primary=matter; payload holds capability_slug, handler_key, stage, gate, summary, outputs[]. is_state_change=false — the capability''s gate advances the matter, not this event.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kind for EVERY OTHER existing legal tenant ───────────────────────────
-- Every tenant with an active firm_settings entity kind is a legal tenant; fresh
-- random ids; idempotent via NOT EXISTS. Tenants created AFTER this migration
-- inherit the kind from the tenant-zero registry clone.
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT gen_random_uuid(), t.tenant_id, 'capability.invoked', 'Platform capability invoked',
   'The workflow engine ran a step-invocable capability as an invoke_capability step. Primary=matter; payload holds capability_slug, handler_key, stage, gate, summary, outputs[]. is_state_change=false — the capability''s gate advances the matter, not this event.',
   false
FROM (
  SELECT DISTINCT tenant_id
  FROM entity_kind_definition
  WHERE kind_name = 'firm_settings' AND status = 'active'
    AND tenant_id <> '00000000-0000-0000-0000-000000000001'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM event_kind_definition e
  WHERE e.tenant_id = t.tenant_id AND e.kind_name = 'capability.invoked'
);
