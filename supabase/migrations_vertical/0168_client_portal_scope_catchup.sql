-- =============================================================================
-- 0168 — client.portal scope catch-up for tenants created after 0136
--
-- 0136 seeded the `client.portal` RBAC rung by looping the tenants that had a
-- `client_contact` kind AT THAT TIME. "Pacheco Law" (ae5530a1, FIRM-PROVISIONING-1)
-- was bootstrapped later and never received it — so the booking funnel's
-- "Create your account" step failed with `action_scope_enforcement_insert`:
-- legal.client.provision_portal_actor creates the (scope-restricted, human)
-- client actor, its scope-assignment SELECT found no client.portal definition
-- and silently no-op'd, and the provision's own client-attributed follow-up
-- write was then denied, rolling the whole account creation back. First hit
-- live on /book/pacheco, 2026-07-17.
--
-- Identical loop + row shape as 0136 (see that header for the rung's design:
-- explicit action allowlist, rank 10, entity read-scoping in the portal query
-- layer). Idempotent: tenants that already hold the scope are skipped, so this
-- is a pure catch-up for late-created tenants.
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

    IF EXISTS (
      SELECT 1 FROM permission_scope_definition
      WHERE tenant_id = t.tenant_id AND scope_name = 'client.portal'
        AND (valid_to IS NULL OR valid_to > now())
    ) THEN
      CONTINUE;
    END IF;

    -- An action row to hang the config change on (config-as-data provenance;
    -- same shape as 0136/0078's per-tenant provisioning action).
    v_action := NULL;
    INSERT INTO action (id, tenant_id, actor_id, action_kind_id, intent_kind, autonomy_tier,
                        hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
    SELECT gen_random_uuid(), t.tenant_id, a.id, akd.id, 'enforcement', 'autonomous',
           now(), 0, a.id, '{"reason": "0168_client_portal_scope_catchup"}'::jsonb
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

    INSERT INTO permission_scope_definition
      (id, tenant_id, action_id, scope_name, display_name, description,
       action_kinds, entity_kinds, attribute_kinds, row_filter_expression, rank, status)
    VALUES
      (gen_random_uuid(), t.tenant_id, v_action, 'client.portal', 'Client (portal)',
       'A signed-in client acting in their own portal: intake, booking, messages, uploads, payment reports, fee consents, and requests — nothing else. Reads are scoped to the client''s own matters in the portal query layer.',
       '["intake.submit","matter.open","booking.create","client.message.post","document.upload","event.record","legal.client_request.create","legal.client_request.accept","legal.fee.quote","legal.fee.accept","legal.fee.decline"]'::jsonb,
       '["*"]'::jsonb, '[]'::jsonb, '{}'::jsonb, 10, 'active');
  END LOOP;
END $$;
