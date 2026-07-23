-- =============================================================================
-- Vertical migration 0194: e-sign ADD-NEXT-SIGNER-1 (Phase 3 of the signer
-- program — PRESIGN-1 #500, service-scoped signers #501)
--
-- PLANNED — not applied to any environment by this PR. Applied post-merge,
-- one `migrate:vertical` pass.
--
-- Adds, config-as-data, no schema change:
--   • signer_allow_add_next (attribute, on signature_request …e2): boolean.
--     Written only when true (mirrors signer_key/signer_title's "absent reads
--     as the safe default" style, not signer_role's "always written" style).
--     Seeded from a template role's allowAddNextSigner (queries/templates.ts)
--     at send/insert time; read back by esign.sign to decide whether THIS
--     signer's completion should hold open for the add-signer decision.
--   • esign.add_signer (action): insert a NEW signature_request mid-envelope
--     — a signer whose role opted in, or the attorney's own "add signer" on
--     an in-flight envelope. Ordered right after an anchor request, ahead of
--     anything already queued later (esign/routing.ts nextInsertionOrder).
--   • esign.finish_signing (action): the deferred completion a signer's "no
--     more signers" confirms (or the attorney's fallback finish) — shares
--     the exact completion tail esign.sign's normal path runs
--     (handlers/esign.ts completeEnvelope). Same autonomy/reversibility as
--     esign.sign itself: it performs the identical effect.
--   • esign.signer_added (event): audit record — a new signer was inserted
--     mid-envelope, by whom (sourceRef), at what order.
--
-- No new envelope_status enum: 'awaiting_signer_decision' is just a new
-- STRING VALUE of the existing envelope_status attribute (same as
-- 'sent'/'completed'/'voided' already are) — no definition row needed.
--
-- Ids: fresh block in the esign "…10152xxx" family (0186/0187's lane),
-- past 0187's highest used suffix (…10152301 attribute, …10152220 event,
-- …0000003400 action). Verified collision-free against every id in
-- migrations_vertical up to and including 0193. ON CONFLICT (id) DO NOTHING
-- for tenant-zero; gen_random_uuid + NOT EXISTS catch-up loop (the 0186
-- idiom) for every other tenant that already has signature_request.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kind (tenant-zero, fixed id) ───────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000010152400', '00000000-0000-0000-0000-000000000001',
   'signer_allow_add_next', 'May add next signer',
   'This signature_request''s role opted in to "let this signer add the next signer" (a template role marked allowAddNextSigner, queries/templates.ts). Written only when true. Read back by esign.sign: if this signer''s signature would otherwise complete the envelope, completion holds open and the signer is offered "add another signer" instead — for a signer count not known at send time. Absent reads as false, the safe default for every request written before this migration.',
   '00000000-0000-0000-1010-0000000000e2', 'boolean', false)
ON CONFLICT (id) DO NOTHING;

-- ── action kinds (tenant-zero, fixed ids) ────────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000010152410', '00000000-0000-0000-0000-000000000001',
   'esign.add_signer', 'Add signer',
   'Insert a new signature_request mid-envelope — a signer whose role opted into "add the next signer", or the attorney''s own "add signer" on an in-flight envelope. Ordered right after an anchor request, ahead of anything already queued later; delivered immediately if nothing else is unresolved ahead of it.',
   'notify', 'reversible_with_external_caveats', NULL, false),
  ('00000000-0000-0000-1013-000010152411', '00000000-0000-0000-0000-000000000001',
   'esign.finish_signing', 'Finish signing (no more signers)',
   'The deferred completion a signer''s "no more signers" confirms, or the attorney''s fallback finish for an envelope stuck awaiting that decision. Runs the exact same completion effect as the last signature on a normal envelope (executed copy, lifecycle dispatch, completion-copy notify).',
   'autonomous', 'irreversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── event kind (tenant-zero, fixed id) ───────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000010152420', '00000000-0000-0000-0000-000000000001',
   'esign.signer_added', 'Signer added',
   'A new signature_request was inserted mid-envelope by esign.add_signer. Payload: name, email, order. Not itself a completion/routing transition (is_state_change=false) — an audit record.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: same kinds for every OTHER tenant that already has the
-- signature_request entity kind (0043). Skips tenant-zero (covered above)
-- and any tenant that already has a kind (re-run safe).
DO $$
DECLARE
  t record;
  req_kind_id uuid;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'signature_request' AND status = 'active'
      AND tenant_id <> '00000000-0000-0000-0000-000000000001'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    SELECT id INTO req_kind_id FROM entity_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'signature_request' AND status = 'active' LIMIT 1;
    IF req_kind_id IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM attribute_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'signer_allow_add_next'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'signer_allow_add_next', 'May add next signer',
         'This signature_request''s role opted in to "let this signer add the next signer". Written only when true; absent reads as false.',
         req_kind_id, 'boolean', false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM action_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'esign.add_signer'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO action_kind_definition
        (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'esign.add_signer', 'Add signer',
         'Insert a new signature_request mid-envelope — a signer whose role opted into "add the next signer", or the attorney''s own "add signer" on an in-flight envelope.',
         'notify', 'reversible_with_external_caveats', NULL, false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM action_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'esign.finish_signing'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO action_kind_definition
        (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'esign.finish_signing', 'Finish signing (no more signers)',
         'The deferred completion a signer''s "no more signers" confirms, or the attorney''s fallback finish for an envelope stuck awaiting that decision.',
         'autonomous', 'irreversible', NULL, false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM event_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'esign.signer_added'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO event_kind_definition
        (id, tenant_id, kind_name, display_name, description, is_state_change)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'esign.signer_added', 'Signer added',
         'A new signature_request was inserted mid-envelope by esign.add_signer.',
         false);
    END IF;
  END LOOP;
END $$;

SELECT public.sync_migration_history();
