-- =============================================================================
-- Vertical migration 0099: the sandbox tenant + enter-sandbox helper (ADR 0046 §6)
--
-- A reserved SANDBOX tenant (00FE…0001) where the operator builds/tests anything
-- in a live environment before promoting it to production tenants. Stood up the
-- bootstrap way (tenant -> actors -> cloned core kind registries -> RBAC + owner
-- role), exactly like cp_bootstrap_tenant does at runtime, then ALL modules
-- enabled. Owner-run migration (bypasses RLS); idempotent (fixed UUIDs / guards).
--
-- The operator reaches the sandbox via "Enter sandbox" in the admin console, which
-- mints an ATTORNEY session for the sandbox owner (cp_tenant_owner) — the sandbox
-- is deliberately EXCLUDED from firm Google sign-in (identity.ts), so this is the
-- only way in, and it keeps the sandbox owner's email from ever hijacking a firm.
--
-- Number 0099 = next after 0098 (0098 seeds the module catalog this depends on).
-- =============================================================================

DO $$
DECLARE
  sb       uuid := '00000000-0000-0000-00FE-000000000001';
  zero     uuid := '00000000-0000-0000-0000-000000000001';
  v_system uuid := '00000000-0000-0000-00FE-000000000002';
  v_owner  uuid := '00000000-0000-0000-00FE-000000000003';
  v_agent  uuid := '00000000-0000-0000-00FE-000000000004';
  v_kind   uuid;
  v_action uuid := '00000000-0000-0000-00FE-0000000000a1';
  t        text;
  cols     text;
  sel      text;
  registries text[] := ARRAY[
    'action_kind_definition','entity_kind_definition','attribute_kind_definition',
    'relationship_kind_definition','event_kind_definition','judgment_kind_definition',
    'outcome_kind_definition'];
BEGIN
  PERFORM set_config('app.tenant_id', sb::text, false);

  INSERT INTO tenant (id, name, status) VALUES (sb, 'Exsto Sandbox', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status) VALUES
    (v_system, sb, 'system', 'system',                 'System',         'active'),
    (v_owner,  sb, 'human',  'sandbox@exsto.platform',  'Sandbox Builder', 'active'),
    (v_agent,  sb, 'agent',  'claude',                  'Claude',          'active')
  ON CONFLICT (id) DO NOTHING;

  -- Clone tenant zero's seven core registries (only if not already cloned).
  IF NOT EXISTS (SELECT 1 FROM action_kind_definition WHERE tenant_id = sb) THEN
    FOREACH t IN ARRAY registries LOOP
      SELECT
        string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
        string_agg(CASE
          WHEN column_name = 'id'        THEN 'gen_random_uuid()'
          WHEN column_name = 'tenant_id' THEN quote_literal(sb) || '::uuid'
          ELSE quote_ident(column_name) END, ', ' ORDER BY ordinal_position)
      INTO cols, sel
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t;
      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM public.%I WHERE tenant_id = %L',
        t, cols, sel, t, zero);
    END LOOP;
    -- Repoint cloned intra-registry entity-kind references to the sandbox's own
    -- kinds (no cross-tenant pointers) — ADR 0046, same as cp_bootstrap_tenant.
    PERFORM private.cp_remap_entity_kind_refs(sb);
  END IF;

  -- Bootstrap action + RBAC + owner super_admin.
  SELECT id INTO v_kind FROM action_kind_definition
   WHERE tenant_id = sb AND kind_name = 'system.bootstrap'
     AND (valid_to IS NULL OR valid_to > now()) LIMIT 1;
  IF v_kind IS NOT NULL THEN
    INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                        hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
    VALUES (v_action, sb, v_kind, v_system, 'enforcement', 'autonomous', now(), 0, v_system, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
    PERFORM private.provision_firm_rbac(sb, v_action);
    PERFORM private.assign_actor_role(sb, v_action, v_owner, 'firm.super_admin');
  END IF;

  -- Enable ALL catalog modules in the sandbox (carry ui_areas for nav gating).
  INSERT INTO module_enablement (id, tenant_id, module_key, enabled, installed_manifest, enabled_at)
  SELECT gen_random_uuid(), sb, md.module_key, true,
         jsonb_build_object('ui_areas', md.ui_areas), now()
  FROM module_definition md
  WHERE md.tenant_id = '00000000-0000-0000-00FF-000000000001' AND md.valid_to IS NULL
  ON CONFLICT (tenant_id, module_key) DO NOTHING;
END $$;

-- Resolve a tenant's owner human actor (platform admins only) — used by the admin
-- console's "Enter sandbox" to mint an attorney session for the sandbox owner.
CREATE OR REPLACE FUNCTION private.cp_tenant_owner(p_platform_actor uuid, p_tenant_id uuid)
RETURNS TABLE (actor_id uuid, display_name text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.id, a.display_name, a.external_id
  FROM public.actor a
  WHERE private.is_platform_admin(p_platform_actor)
    AND a.tenant_id = p_tenant_id
    AND a.actor_type = 'human'
    AND a.status = 'active'
  ORDER BY a.created_at
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.cp_tenant_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cp_tenant_owner(uuid, uuid) TO authenticated;

SELECT public.sync_migration_history();
