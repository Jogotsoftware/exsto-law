-- =============================================================================
-- Vertical migration 0187: template-embedded e-sign config (ESIGN-UNIFY-1 ES-3)
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR. Reserved
-- alongside 0186 (recipient roles + placements, the ES-1 lane); the
-- orchestrator applies both post-merge via the runbook — one `migrate:vertical`
-- pass applies everything pending. Until applied, reads degrade safely: no
-- attribute rows can exist without the kind, so every template reads through
-- the legacy template_signature fallback (parseTemplateEsignConfig /
-- templateSignatureToEsignConfig in queries/templates.ts), and a save attempt
-- throws a clear "kind not found" error — the 0175/0178/0180 posture.
--
-- Two rows, both attribute kinds on the `template` entity (0023's
-- ...1010-000000000008):
--
--   • template_esign_config — THE GATING ITEM (founder walk 15.20): the full
--     role/bind/order declaration that lets the service-builder AI author a
--     signable document end-to-end —
--       { signable: boolean,
--         roles: [{ key,            -- the marker signer key it owns ({{sign:<key>}})
--                   label,          -- "Client", "Managing Member", …
--                   recipientRole,  -- needs_to_sign | needs_to_view | receives_copy
--                   bind,           -- matter_primary_contact | attorney_of_record
--                                   --   | contact_role:<name> | manual
--                   order }] }      -- signing order default; equal = parallel
--     FORMALIZES AND SUPERSEDES template_signature: a template carrying this
--     attribute reads it exclusively; one without it falls back to the legacy
--     declaration (read-time shim, no data migration — values migrate forward
--     on next save). Written via the existing legal.template.create/update
--     actions (handlers/template.ts normalizeEsignConfig); service-bound
--     templates need NO kind — their config nests at
--     workflow_definition.transitions.document_templates.esign[docKind], an
--     existing versioned store (mirrors templates[docKind]).
--
--   • template_signature — FORMALIZATION ONLY: ESIGN-BLOCK-1 defined this kind
--     at runtime via kind.define (demo/seed-template-signature-kind.ts), so
--     prod tenant-zero already carries a row under a random id, but fresh
--     replays and drifted tenants don't. This records it as a migration row,
--     guarded per-tenant by NOT EXISTS on kind_name (the existing prod row
--     wins; nothing is duplicated).
--
-- Configuration-as-data (invariant 8): kinds are rows, not code. Data-only;
-- idempotent (ON CONFLICT (id) DO NOTHING + NOT EXISTS guards). No per-tenant
-- instance data — templates opt in when saved from the new editor panel.
--
-- Ids: attribute family ...1011, reserved trailing lane ...0010152300 per the
-- ESIGN-UNIFY-1 design doc §10 id table (0186 holds the ...0010152200 block;
-- verified: no `10152` trailing id exists in any prior migration).
--
-- Multi-tenant: tenant-zero gets the fixed ids below; every OTHER existing
-- tenant gets the explicit catch-up loop (the 0180 idiom — per-tenant
-- on_entity_kind_id resolved BY NAME, gen_random_uuid() ids, idempotent via
-- NOT EXISTS on kind_name), with cp_sync_all_tenant_vocab() (0174, run by
-- migrate-vertical.mjs after every pass) as the standing backstop. Tenants
-- created after this migration inherit from the tenant-zero registry clone.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── template_esign_config (tenant-zero) ──────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000010152300', '00000000-0000-0000-0000-000000000001',
   'template_esign_config', 'Template e-sign config',
   'ESIGN-UNIFY-1 ES-3: the template''s embedded e-signature declaration — { signable: boolean, roles: [{ key (the {{sign:<key>}} marker signer key the role owns), label, recipientRole (needs_to_sign | needs_to_view | receives_copy), bind (matter_primary_contact | attorney_of_record | contact_role:<name> | manual), order (equal = parallel) }] }. Formalizes and supersedes template_signature: present wins; absent falls back to the legacy declaration. Written via legal.template.create/update; the composer + workflow e-sign step resolve binds to real recipients at send time (api/esignPrefill.ts).',
   '00000000-0000-0000-1010-000000000008', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── template_signature (tenant-zero — FORMALIZATION of the runtime kind) ─────
-- Guarded by kind_name, not just id: prod tenant-zero already carries this kind
-- under a kind.define-era random id, and a second row with the same kind_name
-- at a fixed id would collide on the (tenant_id, kind_name) unique constraint /
-- double-define the vocabulary. Fresh environments get the fixed id.
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000010152301', '00000000-0000-0000-0000-000000000001',
       'template_signature', 'Template signature declaration',
       'ESIGN-BLOCK-1 (WP1): whether the finished document requires signature and by whom — { required: boolean, signer_roles: (client|attorney|witness|notary)[] }. Absent = unsigned. SUPERSEDED by template_esign_config (0187) — read only as the fallback for templates not yet saved under the new editor.',
       '00000000-0000-0000-1010-000000000008', 'json', false
WHERE NOT EXISTS (
  SELECT 1 FROM attribute_kind_definition a
  WHERE a.tenant_id = '00000000-0000-0000-0000-000000000001'
    AND a.kind_name = 'template_signature'
);

-- ── Same kinds for EVERY OTHER existing tenant (0180 idiom) ──────────────────
-- Resolve each tenant's OWN `template` entity kind by NAME (cloned tenants get
-- remapped ids), fresh random kind ids, idempotent via NOT EXISTS on kind_name.
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), tpl.tenant_id, 'template_esign_config', 'Template e-sign config',
       'ESIGN-UNIFY-1 ES-3: the template''s embedded e-signature declaration — { signable, roles: [{ key, label, recipientRole, bind, order }] }. Formalizes and supersedes template_signature; absent falls back to the legacy declaration.',
       tpl.id, 'json', false
FROM entity_kind_definition tpl
WHERE tpl.kind_name = 'template'
  AND tpl.status = 'active'
  AND tpl.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = tpl.tenant_id AND a.kind_name = 'template_esign_config'
  );

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), tpl.tenant_id, 'template_signature', 'Template signature declaration',
       'ESIGN-BLOCK-1 (WP1): whether the finished document requires signature and by whom — { required: boolean, signer_roles: (client|attorney|witness|notary)[] }. Absent = unsigned. Superseded by template_esign_config (0187).',
       tpl.id, 'json', false
FROM entity_kind_definition tpl
WHERE tpl.kind_name = 'template'
  AND tpl.status = 'active'
  AND tpl.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = tpl.tenant_id AND a.kind_name = 'template_signature'
  );

SELECT public.sync_migration_history();
