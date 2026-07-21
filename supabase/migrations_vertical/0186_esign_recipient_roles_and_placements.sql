-- =============================================================================
-- Vertical migration 0186: e-sign recipient roles + placement storage (ESIGN-
-- UNIFY-1, ES-1 — docs/design/esign-unify/DESIGN.md §5.1, §9.2, §10)
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR. Applied
-- post-merge by the orchestrator via the runbook (one `migrate:vertical` pass
-- applies this alongside 0187, ES-3's migration).
--
-- Adds, config-as-data, no schema change:
--   • signer_role (attribute, on signature_request …e2): 'needs_to_sign' |
--     'needs_to_view' | 'receives_copy'. A request with NO row (every envelope
--     sent before this migration) reads as 'needs_to_sign' — the ONLY role that
--     existed before ES-1 — via a defensive default in the reading code, never
--     a NULL/unknown state that could silently drop a legacy signer from
--     completion accounting.
--   • envelope_placements (attribute, on signature_envelope …e1): json
--     FieldPlacement[] (verticals/legal/src/esign/placements.ts). Supersedes
--     envelope_fields (0044) for envelopes sent by the new composer; old
--     envelopes keep reading through envelope_fields (§5.1) — no data
--     migration, both attributes coexist.
--   • envelope_message (attribute, on signature_envelope …e1): text, the
--     sender's personal note from the composer's Review & send step — flows
--     into the branded signing email body (§9.4).
--   • esign.copy_delivered (event): a receives_copy recipient was sent the
--     executed copy once the envelope completed. is_state_change=false — a
--     notification record, not itself a lifecycle transition.
--   • esign_copy_delivered (notification route): email, template_ref
--     'esign-copy-delivered' (verticals/legal/src/email/templates.ts).
--
-- No new actions: roles/placements/message ride the existing esign.send
-- payload (handlers/esign.ts); the copy-delivered notification is queued from
-- the api layer after esign.sign completes the envelope (design §2 principle
-- 4 — no draft-envelope edit action kinds).
--
-- Ids: reserved lane per the design doc's id table — fresh …0010152200 trailing
-- block (verified collision-free: no `10152` trailing id exists in any
-- migrations_vertical file up to and including 0185). ON CONFLICT (id) DO
-- NOTHING throughout.
--
-- Multi-tenant: tenant-zero gets the fixed ids below; every OTHER tenant that
-- already has the signature_request / signature_envelope entity kinds (0043)
-- gets the catch-up loop (gen_random_uuid, idempotent by NOT EXISTS) — the
-- 0184 idiom. cp_sync_all_tenant_vocab() (0174) is the standing backstop for
-- tenants created after this migration lands.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── attribute kinds (tenant-zero, fixed ids) ─────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000010152200', '00000000-0000-0000-0000-000000000001',
   'signer_role', 'Recipient role',
   'This signature_request''s role in the envelope: needs_to_sign | needs_to_view | receives_copy (design §9.2). A request with no row for this attribute (every envelope sent before ESIGN-UNIFY-1) reads as needs_to_sign — the only role that existed before this migration. Completion ("all signers signed") iterates ONLY needs_to_sign requests; needs_to_view is delivered with the first routing group and never blocks completion; receives_copy is never delivered at send and is notified with the executed copy once the envelope completes (esign.copy_delivered).',
   '00000000-0000-0000-1010-0000000000e2', 'enum', false),
  ('00000000-0000-0000-1011-000010152201', '00000000-0000-0000-0000-000000000001',
   'envelope_placements', 'Field placements',
   'The resolved coordinate field-placement plan for this envelope: json FieldPlacement[] (verticals/legal/src/esign/placements.ts) — id, type, signerKey, required, label, source (anchor|placed), optional anchor {type,key,occurrence}, and a normalized page rect {page,x,y,w,h}. Supersedes envelope_fields (0044, the whole-line marker model) for envelopes sent by the unified composer; envelopes sent before this migration have no row here and keep rendering through envelope_fields.',
   '00000000-0000-0000-1010-0000000000e1', 'json', false),
  ('00000000-0000-0000-1011-000010152202', '00000000-0000-0000-0000-000000000001',
   'envelope_message', 'Personal message',
   'The sender''s personal note, entered on the composer''s Review & send step. Optional (absent for envelopes with no message). Rendered in the branded signing email body (esign-sign-request / esign-sign-request-portal templates, design §9.4) below the sender identity line.',
   '00000000-0000-0000-1010-0000000000e1', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── event kind (tenant-zero, fixed id) ───────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000010152220', '00000000-0000-0000-0000-000000000001',
   'esign.copy_delivered', 'Copy delivered',
   'A receives_copy recipient was sent the executed copy of a completed envelope. Fired once per copy recipient when the envelope''s esign.completed fires (handlers/esign.ts). Payload: none beyond the standard action/actor provenance; primary_entity_id is the envelope, secondary_entity_ids carries the signature_request. Not itself a lifecycle transition (is_state_change=false) — a notification record.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── notification route: the receives_copy recipient's executed-copy email ────
-- Mirrors the esign_sign_request / esign_sign_request_portal route shape (0043/
-- 0044): action_id = the same bootstrap action those routes use.
INSERT INTO notification_route_definition
  (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config) VALUES
  ('00000000-0000-0000-1030-000010152230', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'esign_copy_delivered', 'E-sign: copy delivered',
   'email', '{"role":"client"}'::jsonb, 'esign-copy-delivered', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── Catch-up: same kinds for every OTHER tenant that already has the
-- signature_request / signature_envelope entity kinds (0043). Skips tenant-zero
-- (already covered above) and any tenant that somehow already has a kind
-- (re-run safe).
DO $$
DECLARE
  t record;
  req_kind_id uuid;
  env_kind_id uuid;
  bootstrap_action_id uuid;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'signature_request' AND status = 'active'
      AND tenant_id <> '00000000-0000-0000-0000-000000000001'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);

    SELECT id INTO req_kind_id FROM entity_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'signature_request' AND status = 'active' LIMIT 1;
    SELECT id INTO env_kind_id FROM entity_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'signature_envelope' AND status = 'active' LIMIT 1;
    IF req_kind_id IS NULL OR env_kind_id IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM attribute_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'signer_role'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'signer_role', 'Recipient role',
         'This signature_request''s role in the envelope: needs_to_sign | needs_to_view | receives_copy. A request with no row for this attribute reads as needs_to_sign.',
         req_kind_id, 'enum', false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM attribute_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'envelope_placements'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'envelope_placements', 'Field placements',
         'The resolved coordinate field-placement plan for this envelope: json FieldPlacement[]. Supersedes envelope_fields for envelopes sent by the unified composer.',
         env_kind_id, 'json', false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM attribute_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'envelope_message'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO attribute_kind_definition
        (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'envelope_message', 'Personal message',
         'The sender''s personal note, entered on the composer''s Review & send step.',
         env_kind_id, 'text', false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM event_kind_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'esign.copy_delivered'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO event_kind_definition
        (id, tenant_id, kind_name, display_name, description, is_state_change)
      VALUES
        (gen_random_uuid(), t.tenant_id,
         'esign.copy_delivered', 'Copy delivered',
         'A receives_copy recipient was sent the executed copy of a completed envelope.',
         false);
    END IF;

    SELECT id INTO bootstrap_action_id FROM action WHERE tenant_id = t.tenant_id ORDER BY recorded_at LIMIT 1;
    IF bootstrap_action_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM notification_route_definition
      WHERE tenant_id = t.tenant_id AND kind_name = 'esign_copy_delivered'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO notification_route_definition
        (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config)
      VALUES
        (gen_random_uuid(), t.tenant_id, bootstrap_action_id,
         'esign_copy_delivered', 'E-sign: copy delivered',
         'email', '{"role":"client"}'::jsonb, 'esign-copy-delivered', '{}'::jsonb);
    END IF;
  END LOOP;
END $$;

SELECT public.sync_migration_history();
