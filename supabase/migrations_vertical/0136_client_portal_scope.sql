-- =============================================================================
-- 0136 — PORTAL-1: the client's RBAC scope
--
-- A client portal actor is a HUMAN actor, and the RBAC ladder (0078) restricts
-- every human actor to its assigned scopes — so the client actor gets its own
-- rung: `client.portal`, an EXPLICIT allowlist of exactly the action kinds the
-- portal lets a signed-in client fire (rank 10, the lowest). No wildcard on
-- actions: a client can never invoke attorney/admin/authoring kinds even if a
-- route bug exposed one.
--
-- entity_kinds is '*': read isolation for clients lives in the portal QUERY
-- layer (every read resolves from the session's client and scopes to their own
-- matters — same guarantee as before this migration, when portal reads ran as
-- the unrestricted public-intake system actor). Event-level read scoping is the
-- substrate-wide follow-up 0078 already tracks for the paralegal rung.
--
-- The legal.client.provision_portal_actor handler assigns this scope when it
-- creates the actor (same transaction, same audited action).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

DO $$
DECLARE
  t record;
  v_action uuid;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM entity_kind_definition
    WHERE kind_name = 'client_contact' AND status = 'active'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    -- An action row to hang the config change on (config-as-data provenance;
    -- same shape as 0078's per-tenant RBAC provisioning action).
    v_action := NULL;
    INSERT INTO action (id, tenant_id, actor_id, action_kind_id, intent_kind, autonomy_tier,
                        hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
    SELECT gen_random_uuid(), t.tenant_id, a.id, akd.id, 'enforcement', 'autonomous',
           now(), 0, a.id, '{"reason": "0136_client_portal_scope"}'::jsonb
    FROM actor a
    JOIN action_kind_definition akd
      ON akd.tenant_id = t.tenant_id AND akd.kind_name = 'config.change'
    WHERE a.tenant_id = t.tenant_id AND a.actor_type = 'system' AND a.status = 'active'
    ORDER BY a.created_at
    LIMIT 1
    RETURNING id INTO v_action;

    IF v_action IS NULL THEN
      RAISE NOTICE 'tenant % has no system actor or config.change kind; skipped', t.tenant_id;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM permission_scope_definition
      WHERE tenant_id = t.tenant_id AND scope_name = 'client.portal'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      INSERT INTO permission_scope_definition
        (id, tenant_id, action_id, scope_name, display_name, description,
         action_kinds, entity_kinds, attribute_kinds, row_filter_expression, rank, status)
      VALUES
        (gen_random_uuid(), t.tenant_id, v_action, 'client.portal', 'Client (portal)',
         'A signed-in client acting in their own portal: intake, booking, messages, uploads, payment reports, fee consents, and requests — nothing else. Reads are scoped to the client''s own matters in the portal query layer.',
         '["intake.submit","matter.open","booking.create","client.message.post","document.upload","event.record","legal.client_request.create","legal.client_request.accept","legal.fee.quote","legal.fee.accept","legal.fee.decline"]'::jsonb,
         '["*"]'::jsonb, '[]'::jsonb, '{}'::jsonb, 10, 'active');
    END IF;
  END LOOP;
END $$;
