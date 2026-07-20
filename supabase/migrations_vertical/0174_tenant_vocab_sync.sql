-- =============================================================================
-- Vertical migration 0174 (renumbered from 0173; 0173 = esign_any_document on main): tenant vocabulary sync (every tenant has all it needs)
--
-- THE DRIFT THIS CLOSES: feature migrations seed new kinds into TENANT ZERO by
-- convention (0169's header calls the cross-tenant path "the normal bootstrap/
-- replay path") — but the only bootstrap copy runs ONCE, at tenant creation
-- (private.cp_bootstrap_tenant, 0101), and no replay job ever existed. Every
-- kind added after a tenant was bootstrapped therefore never reached it:
-- measured on prod 2026-07-19 — Liberty Legal missing 182 vocabulary rows,
-- Exsto Sandbox 74, Pacheco Law 13 (incl. esign.void, the brief kinds) — and
-- notification_route_definition was NEVER cloned at all, so every non-zero
-- tenant is missing ALL 12 email routes (esign links, intake confirmations…
-- would dead-letter).
--
-- WHAT THIS ADDS (config-as-data; no new tables):
--   private.cp_sync_tenant_vocab(p_tenant)  — copy tenant zero's ACTIVE rows a
--     tenant is missing (matched BY kind_name, verified unique among active
--     rows in tenant zero) across the seven kind registries, re-point cloned
--     entity-kind references (cp_remap_entity_kind_refs, 0101), then clone
--     missing notification routes under a per-tenant config.change provenance
--     action (the 0168 catch-up recipe). Returns a jsonb insert-count summary.
--   private.cp_sync_all_tenant_vocab()      — run it for every active tenant
--     except tenant zero (the template) and the Exsto Platform control-plane
--     tenant (00ff…0001, which deliberately holds no legal vocabulary).
--
-- It RUNS the catch-up at apply time, and scripts/migrate-vertical.mjs now
-- calls cp_sync_all_tenant_vocab() after every migration run — so a future
-- migration that seeds tenant zero reaches every tenant in the same `pnpm
-- migrate:vertical`, and the drift class is closed permanently, not once.
--
-- WHAT THIS DELIBERATELY DOES NOT SYNC: firm-authored content — services
-- (workflow_definition, promoted via controlPlane/promotion.ts), templates
-- (templatePromotion.ts), skills/capability libraries, firm settings. Those
-- are per-firm decisions with their own replay engines (FIRM-PROVISIONING-2).
-- RBAC roles/scopes stay with private.provision_firm_rbac (0164) + 0168.
--
-- Idempotent: every insert is guarded by a per-kind_name NOT EXISTS; re-running
-- inserts nothing and the provenance action is only written when routes are
-- actually missing. No new kind ids (functions only — no id block consumed).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── per-tenant sync ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.cp_sync_tenant_vocab(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  zero    uuid := '00000000-0000-0000-0000-000000000001';
  t       text;
  cols    text;
  sel     text;
  n       bigint;
  v_action uuid;
  v_missing bigint;
  summary jsonb := '{}'::jsonb;
  -- Entity kinds FIRST: attribute/relationship/judgment/outcome rows cloned in
  -- the same pass reference entity kinds by id, and the remap below resolves
  -- them by name against THIS tenant's (just-completed) entity registry.
  registries text[] := ARRAY[
    'entity_kind_definition','action_kind_definition','attribute_kind_definition',
    'relationship_kind_definition','event_kind_definition','judgment_kind_definition',
    'outcome_kind_definition'];
BEGIN
  IF p_tenant = zero THEN
    RETURN jsonb_build_object('skipped', 'tenant zero is the template');
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);

  -- Clone missing ACTIVE rows per registry, matched by kind_name (the same key
  -- lookupKindId resolves at runtime). Fresh id, target tenant, every other
  -- column verbatim — the cp_bootstrap_tenant introspection pattern (0101),
  -- narrowed from "only if the registry is empty" to per-row NOT EXISTS.
  FOREACH t IN ARRAY registries LOOP
    SELECT
      string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
      string_agg(CASE
        WHEN column_name = 'id'        THEN 'gen_random_uuid()'
        WHEN column_name = 'tenant_id' THEN quote_literal(p_tenant) || '::uuid'
        ELSE 'z.' || quote_ident(column_name) END, ', ' ORDER BY ordinal_position)
    INTO cols, sel
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t;

    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM public.%I z '
      || 'WHERE z.tenant_id = %L AND z.status = ''active'' '
      || 'AND NOT EXISTS (SELECT 1 FROM public.%I b WHERE b.tenant_id = %L '
      || 'AND b.kind_name = z.kind_name AND b.status = ''active'')',
      t, cols, sel, t, zero, t, p_tenant);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      summary := summary || jsonb_build_object(t, n);
    END IF;
  END LOOP;

  -- Cloned rows still carry tenant zero's entity-kind ids in their reference
  -- columns; re-point them to this tenant's same-named kinds (ADR 0046).
  PERFORM private.cp_remap_entity_kind_refs(p_tenant);

  -- Notification routes were never part of the bootstrap clone. Clone the
  -- missing ones under a per-tenant provenance action (0168 recipe: the
  -- tenant's own system actor + its config.change kind — which exists by now,
  -- the action registry was just synced). trigger_definition_id is forced NULL:
  -- no tenant-zero route uses one (verified on prod), and a verbatim copy
  -- would be a cross-tenant pointer.
  SELECT count(*) INTO v_missing
    FROM public.notification_route_definition z
   WHERE z.tenant_id = zero AND z.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.notification_route_definition b
                      WHERE b.tenant_id = p_tenant AND b.kind_name = z.kind_name
                        AND b.status = 'active');
  IF v_missing > 0 THEN
    v_action := NULL;
    INSERT INTO public.action (id, tenant_id, actor_id, action_kind_id, intent_kind,
                               autonomy_tier, hlc_physical_time, hlc_logical_counter,
                               hlc_source_id, payload)
    SELECT gen_random_uuid(), p_tenant, a.id, akd.id, 'enforcement', 'autonomous',
           now(), 0, a.id, '{"reason": "cp_sync_tenant_vocab: notification route catch-up"}'::jsonb
      FROM public.actor a
      JOIN public.action_kind_definition akd
        ON akd.tenant_id = p_tenant AND akd.kind_name = 'config.change'
       AND (akd.valid_to IS NULL OR akd.valid_to > now())
     WHERE a.tenant_id = p_tenant AND a.actor_type = 'system' AND a.status = 'active'
     ORDER BY a.created_at
     LIMIT 1
    RETURNING id INTO v_action;

    IF v_action IS NULL THEN
      summary := summary
        || jsonb_build_object('notification_route_definition',
             'skipped: no system actor or config.change kind');
    ELSE
      INSERT INTO public.notification_route_definition
        (id, tenant_id, action_id, kind_name, display_name, trigger_definition_id,
         channel, recipients, template_ref, config, status)
      SELECT gen_random_uuid(), p_tenant, v_action, z.kind_name, z.display_name, NULL,
             z.channel, z.recipients, z.template_ref, z.config, z.status
        FROM public.notification_route_definition z
       WHERE z.tenant_id = zero AND z.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM public.notification_route_definition b
                          WHERE b.tenant_id = p_tenant AND b.kind_name = z.kind_name
                            AND b.status = 'active');
      GET DIAGNOSTICS n = ROW_COUNT;
      summary := summary || jsonb_build_object('notification_route_definition', n);
    END IF;
  END IF;

  RETURN summary;
END $$;
REVOKE ALL ON FUNCTION private.cp_sync_tenant_vocab(uuid) FROM PUBLIC, anon;

-- ── all-tenant sweep ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.cp_sync_all_tenant_vocab()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  zero     uuid := '00000000-0000-0000-0000-000000000001';
  platform uuid := '00000000-0000-0000-00ff-000000000001';
  r        record;
  out_j    jsonb := '{}'::jsonb;
  one      jsonb;
BEGIN
  FOR r IN
    SELECT id FROM public.tenant
     WHERE status = 'active' AND id NOT IN (zero, platform)
     ORDER BY created_at
  LOOP
    one := private.cp_sync_tenant_vocab(r.id);
    -- Only tenants that actually received something appear in the summary.
    IF one <> '{}'::jsonb THEN
      out_j := out_j || jsonb_build_object(r.id::text, one);
    END IF;
  END LOOP;
  RETURN out_j;
END $$;
REVOKE ALL ON FUNCTION private.cp_sync_all_tenant_vocab() FROM PUBLIC, anon;

-- ── run the catch-up now, surfacing what each tenant received ────────────────
DO $$
BEGIN
  RAISE NOTICE 'cp_sync_all_tenant_vocab: %', private.cp_sync_all_tenant_vocab();
END $$;

SELECT public.sync_migration_history();
