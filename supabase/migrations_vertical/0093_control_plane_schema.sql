-- =============================================================================
-- Vertical migration 0093: platform control plane — schema + guarded functions
--
-- exsto-law runs live with real firm tenants, but there is no platform-operator
-- surface: no way to see all firms, stand one up, or act across them. Everything
-- is tenant-scoped and RLS on `tenant` is self-select-only (ADR 0001), and hard
-- rules 2 & 9 forbid an "admin override" path / service_role / a request-supplied
-- tenant. A platform console must nonetheless read the tenant registry and act
-- across tenants.
--
-- Resolution (ADR 0046, "narrow & audited"): the ONLY cross-tenant capability
-- lives in narrow SECURITY DEFINER functions in the `private` schema — the exact
-- shape migration 0024 (auth_resolve_api_key) already uses for the cross-tenant
-- API-key lookup. PostgREST exposes only public/graphql_public, so `private`
-- functions are unreachable over the data API; the app calls them over its pg
-- connection as the non-owner `authenticated` role (via withAppRole). Every
-- function first checks is_platform_admin(actor) and returns nothing / raises
-- otherwise. Per-tenant *operations* use no override at all — they go through
-- submitAction with the target tenant's ActionContext (the app layer).
--
-- A reserved platform tenant (00FF…0001) holds platform-admin actors + the
-- control-plane audit log. It is an ordinary tenant for RLS; nothing about it
-- bypasses anything.
--
-- All new tables carry tenant_id + RLS (invariant 1); control_plane_action is
-- append-only (invariant 9/14). This is clone-owned schema → vertical namespace,
-- never supabase/migrations/ (ADR 0043).
--
-- Number 0093 = next free across origin/main (max 0092 = client_request_kinds)
-- and all remote branches; verified before authoring. Vertical files are
-- checksum-immutable once applied (scripts/migrate-vertical.mjs) — forward-only.
-- =============================================================================

-- Reserved platform tenant + its system actor. Bootstrap-order (exsto-bootstrap-
-- tenant): tenant row first, then actors. Fixed UUIDs + ON CONFLICT = idempotent.
SELECT set_config('app.tenant_id', '00000000-0000-0000-00FF-000000000001', false);

INSERT INTO tenant (id, name, status) VALUES
  ('00000000-0000-0000-00FF-000000000001', 'Exsto Platform', 'active')
ON CONFLICT (id) DO NOTHING;

-- The platform's own system actor (provenance for platform-initiated bootstraps).
INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status) VALUES
  ('00000000-0000-0000-00FF-000000000002', '00000000-0000-0000-00FF-000000000001',
   'system', 'system', 'Platform System', 'active')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- platform_admin — who may operate the control plane. Authority source of truth
-- (an env allowlist may bootstrap, but the row is what is_platform_admin checks).
-- Lifecycle/infra table (like api_key): revoked_at mutated in place; no DELETE.
-- tenant_id is pinned to the platform tenant so it sits under platform-tenant RLS
-- and satisfies the universal tenancy invariant.
-- -----------------------------------------------------------------------------
CREATE TABLE platform_admin (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  actor_id            uuid        NOT NULL REFERENCES actor(id),
  email               text        NOT NULL,
  granted_by_actor_id uuid        REFERENCES actor(id),
  granted_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX platform_admin_email_active_idx
  ON platform_admin (lower(email)) WHERE revoked_at IS NULL;
CREATE INDEX platform_admin_actor_idx ON platform_admin (actor_id);

ALTER TABLE platform_admin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_admin FROM anon;

CREATE POLICY platform_admin_select ON platform_admin
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY platform_admin_insert ON platform_admin
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY platform_admin_update ON platform_admin
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- No DELETE policy: admins are revoked (revoked_at), not deleted.

-- -----------------------------------------------------------------------------
-- control_plane_action — append-only audit of every cross-tenant control-plane
-- operation: who (platform actor), what (operation), against which target tenant,
-- with payload + result. The platform-side mirror of the per-tenant `action` log.
-- Append-only (ADR 0014): UPDATE/DELETE denied structurally.
-- -----------------------------------------------------------------------------
CREATE TABLE control_plane_action (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id),     -- the platform tenant
  platform_actor_id uuid        NOT NULL REFERENCES actor(id),
  operation         text        NOT NULL,
  target_tenant_id  uuid,                                          -- null for registry reads
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  result            jsonb,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX control_plane_action_recorded_idx ON control_plane_action (recorded_at DESC);
CREATE INDEX control_plane_action_target_idx ON control_plane_action (target_tenant_id);

ALTER TABLE control_plane_action ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_plane_action FROM anon;

CREATE POLICY cpa_select ON control_plane_action
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cpa_insert ON control_plane_action
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cpa_no_update ON control_plane_action FOR UPDATE USING (false);
CREATE POLICY cpa_no_delete ON control_plane_action FOR DELETE USING (false);
-- True append-only parity with the core action log (invariant 14): the blocking
-- trigger (0017) stops UPDATE/DELETE even for a BYPASSRLS/owner role, not just the
-- RLS-subject app role the deny policies above cover.
CREATE TRIGGER zzz_append_only BEFORE UPDATE OR DELETE ON control_plane_action
  FOR EACH ROW EXECUTE FUNCTION public.substrate_block_write();

-- =============================================================================
-- Guarded private functions — the ONLY cross-tenant surface (ADR 0046, 0024).
-- The platform tenant id is a fixed literal inside the guard so a caller cannot
-- pass a different tenant. p_platform_actor comes from the server-verified admin
-- session cookie, never from a request body.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- The guard: is this actor an active platform admin in the platform tenant?
CREATE OR REPLACE FUNCTION private.is_platform_admin(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admin pa
    JOIN public.actor a ON a.id = pa.actor_id
    WHERE pa.actor_id = p_actor_id
      AND pa.tenant_id = '00000000-0000-0000-00FF-000000000001'::uuid
      AND pa.revoked_at IS NULL
      AND a.status = 'active'
  )
$$;

-- List the full tenant registry — the legitimate "list all tenants" path. Returns
-- zero rows unless the caller is a platform admin (tenant RLS stays untouched).
CREATE OR REPLACE FUNCTION private.cp_list_tenants(p_platform_actor uuid)
RETURNS TABLE (id uuid, name text, status text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.name, t.status, t.created_at
  FROM public.tenant t
  WHERE private.is_platform_admin(p_platform_actor)
  ORDER BY t.created_at
$$;

CREATE OR REPLACE FUNCTION private.cp_get_tenant(p_platform_actor uuid, p_tenant_id uuid)
RETURNS TABLE (id uuid, name text, status text, created_at timestamptz,
               actor_count bigint, human_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.name, t.status, t.created_at,
         (SELECT count(*) FROM public.actor a WHERE a.tenant_id = t.id),
         (SELECT count(*) FROM public.actor a WHERE a.tenant_id = t.id AND a.actor_type = 'human')
  FROM public.tenant t
  WHERE private.is_platform_admin(p_platform_actor)
    AND t.id = p_tenant_id
$$;

-- Resolve the dedicated per-tenant "platform" actor used to author impersonated
-- per-tenant operations (so the target's own audit reads "by the platform
-- console", not the firm's system actor). Created on demand; returns its id.
CREATE OR REPLACE FUNCTION private.cp_platform_actor_for(p_platform_actor uuid, p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_id     uuid;
  v_kind   uuid;
  v_action uuid;
BEGIN
  IF NOT private.is_platform_admin(p_platform_actor) THEN
    RAISE EXCEPTION 'not a platform admin';
  END IF;
  SELECT id INTO v_id FROM public.actor
   WHERE tenant_id = p_tenant_id AND actor_type = 'system' AND external_id = 'platform-console'
   LIMIT 1;
  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
    INSERT INTO public.actor (id, tenant_id, actor_type, external_id, display_name, status)
    VALUES (v_id, p_tenant_id, 'system', 'platform-console', 'Platform Console', 'active');

    -- Grant the impersonation actor a PLATFORM scope so it can run ANY firm
    -- operation on the tenant's behalf. It must (a) read as admin (the user-mgmt
    -- core's requireAdmin keys on scope NAME — platform.super_admin is in
    -- ADMIN_SCOPES) and (b) OUT-RANK every firm role so the strict rank-ceiling
    -- checks + the DB RLS floor pass even when (re)appointing a firm super_admin
    -- (rank 100). So it sits at rank 1000 with wildcard action/entity kinds. It is
    -- a 'system' actor, so it never appears in the firm's (human-only) user list,
    -- and no human firm user ever holds this scope. Done once, at creation.
    SELECT id INTO v_kind FROM public.action_kind_definition
     WHERE tenant_id = p_tenant_id AND kind_name = 'system.bootstrap'
       AND (valid_to IS NULL OR valid_to > now()) LIMIT 1;
    IF v_kind IS NOT NULL THEN
      v_action := gen_random_uuid();
      INSERT INTO public.action (id, tenant_id, action_kind_id, actor_id, intent_kind,
                                 autonomy_tier, hlc_physical_time, hlc_logical_counter,
                                 hlc_source_id, payload)
      VALUES (v_action, p_tenant_id, v_kind, v_id, 'enforcement', 'autonomous',
              now(), 0, v_id, '{}'::jsonb);
      -- Ensure the platform.super_admin scope exists in this tenant (idempotent).
      IF NOT EXISTS (
        SELECT 1 FROM public.permission_scope_definition
         WHERE tenant_id = p_tenant_id AND scope_name = 'platform.super_admin'
           AND (valid_to IS NULL OR valid_to > now())
      ) THEN
        INSERT INTO public.permission_scope_definition
          (id, tenant_id, action_id, scope_name, display_name, description,
           action_kinds, entity_kinds, attribute_kinds, row_filter_expression, rank, status)
        VALUES (gen_random_uuid(), p_tenant_id, v_action, 'platform.super_admin',
                'Platform Console', 'Platform operator impersonation scope (out-ranks all firm roles).',
                '["*"]'::jsonb, '["*"]'::jsonb, '[]'::jsonb, '{}'::jsonb, 1000, 'active');
      END IF;
      PERFORM private.assign_actor_role(p_tenant_id, v_action, v_id, 'platform.super_admin');
    END IF;
  END IF;
  RETURN v_id;
END $$;

-- Append a control-plane audit row. Guarded; runs as definer so the platform
-- tenant's append-only RLS is satisfied without the app holding a tenant binding.
CREATE OR REPLACE FUNCTION private.cp_audit(
  p_platform_actor uuid, p_operation text, p_target_tenant uuid,
  p_payload jsonb, p_result jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT private.is_platform_admin(p_platform_actor) THEN
    RAISE EXCEPTION 'not a platform admin';
  END IF;
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-00FF-000000000001', true);
  INSERT INTO public.control_plane_action
    (id, tenant_id, platform_actor_id, operation, target_tenant_id, payload, result)
  VALUES (v_id, '00000000-0000-0000-00FF-000000000001'::uuid, p_platform_actor,
          p_operation, p_target_tenant, COALESCE(p_payload, '{}'::jsonb), p_result);
  RETURN v_id;
END $$;

-- Read the control-plane audit log (platform admins only).
CREATE OR REPLACE FUNCTION private.cp_audit_log(p_platform_actor uuid, p_limit int)
RETURNS TABLE (id uuid, platform_actor_id uuid, operation text, target_tenant_id uuid,
               payload jsonb, result jsonb, recorded_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.id, c.platform_actor_id, c.operation, c.target_tenant_id, c.payload, c.result, c.recorded_at
  FROM public.control_plane_action c
  WHERE private.is_platform_admin(p_platform_actor)
  ORDER BY c.recorded_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
$$;

-- Repoint a cloned tenant's intra-registry FKs into entity_kind_definition so they
-- reference THIS tenant's same-named entity kind, not the source tenant's (the
-- clone copies these columns verbatim). Idempotent; safe to re-run. Internal helper
-- (called by cp_bootstrap_tenant and the sandbox migration), not granted to apps.
CREATE OR REPLACE FUNCTION private.cp_remap_entity_kind_refs(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
BEGIN
  UPDATE public.entity_kind_definition e SET parent_kind_id = (
    SELECT n.id FROM public.entity_kind_definition n WHERE n.tenant_id = p_tenant
      AND n.kind_name = (SELECT z.kind_name FROM public.entity_kind_definition z WHERE z.id = e.parent_kind_id))
   WHERE e.tenant_id = p_tenant AND e.parent_kind_id IS NOT NULL;
  UPDATE public.attribute_kind_definition a SET on_entity_kind_id = (
    SELECT n.id FROM public.entity_kind_definition n WHERE n.tenant_id = p_tenant
      AND n.kind_name = (SELECT z.kind_name FROM public.entity_kind_definition z WHERE z.id = a.on_entity_kind_id))
   WHERE a.tenant_id = p_tenant AND a.on_entity_kind_id IS NOT NULL;
  UPDATE public.relationship_kind_definition r SET source_entity_kind_id = (
    SELECT n.id FROM public.entity_kind_definition n WHERE n.tenant_id = p_tenant
      AND n.kind_name = (SELECT z.kind_name FROM public.entity_kind_definition z WHERE z.id = r.source_entity_kind_id))
   WHERE r.tenant_id = p_tenant AND r.source_entity_kind_id IS NOT NULL;
  UPDATE public.relationship_kind_definition r SET target_entity_kind_id = (
    SELECT n.id FROM public.entity_kind_definition n WHERE n.tenant_id = p_tenant
      AND n.kind_name = (SELECT z.kind_name FROM public.entity_kind_definition z WHERE z.id = r.target_entity_kind_id))
   WHERE r.tenant_id = p_tenant AND r.target_entity_kind_id IS NOT NULL;
  UPDATE public.judgment_kind_definition j SET about_entity_kind_id = (
    SELECT n.id FROM public.entity_kind_definition n WHERE n.tenant_id = p_tenant
      AND n.kind_name = (SELECT z.kind_name FROM public.entity_kind_definition z WHERE z.id = j.about_entity_kind_id))
   WHERE j.tenant_id = p_tenant AND j.about_entity_kind_id IS NOT NULL;
  UPDATE public.outcome_kind_definition o SET about_entity_kind_id = (
    SELECT n.id FROM public.entity_kind_definition n WHERE n.tenant_id = p_tenant
      AND n.kind_name = (SELECT z.kind_name FROM public.entity_kind_definition z WHERE z.id = o.about_entity_kind_id))
   WHERE o.tenant_id = p_tenant AND o.about_entity_kind_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION private.cp_remap_entity_kind_refs(uuid) FROM PUBLIC, anon;

-- Bootstrap a new tenant the substrate way (exsto-bootstrap-tenant): tenant row →
-- actors → clone tenant zero's seven core kind registries → RBAC + owner role.
-- The one thing `authenticated` cannot do directly (tenant has no INSERT policy)
-- and the cross-tenant clone both happen here, under the is_platform_admin guard.
-- Idempotent: a no-op if the tenant already has actors. Returns the owner actor id.
CREATE OR REPLACE FUNCTION private.cp_bootstrap_tenant(
  p_platform_actor uuid, p_new_tenant uuid, p_name text,
  p_owner_email text, p_owner_display_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  zero     uuid := '00000000-0000-0000-0000-000000000001';
  v_system uuid;
  v_owner  uuid;
  v_agent  uuid;
  v_kind   uuid;
  v_action uuid;
  t        text;
  cols     text;
  sel      text;
  registries text[] := ARRAY[
    'action_kind_definition','entity_kind_definition','attribute_kind_definition',
    'relationship_kind_definition','event_kind_definition','judgment_kind_definition',
    'outcome_kind_definition'];
BEGIN
  IF NOT private.is_platform_admin(p_platform_actor) THEN
    RAISE EXCEPTION 'not a platform admin';
  END IF;
  IF p_new_tenant IS NULL OR p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'tenant id and name are required';
  END IF;

  -- Idempotent re-run guard: if the tenant already has actors, return the owner.
  IF EXISTS (SELECT 1 FROM public.actor WHERE tenant_id = p_new_tenant) THEN
    SELECT id INTO v_owner FROM public.actor
     WHERE tenant_id = p_new_tenant AND actor_type = 'human' ORDER BY created_at LIMIT 1;
    RETURN v_owner;
  END IF;

  PERFORM set_config('app.tenant_id', p_new_tenant::text, true);

  INSERT INTO public.tenant (id, name, status) VALUES (p_new_tenant, p_name, 'active')
  ON CONFLICT (id) DO NOTHING;

  v_system := gen_random_uuid();
  v_owner  := gen_random_uuid();
  v_agent  := gen_random_uuid();
  INSERT INTO public.actor (id, tenant_id, actor_type, external_id, display_name, status) VALUES
    (v_system, p_new_tenant, 'system', 'system', 'System', 'active'),
    (v_owner,  p_new_tenant, 'human',  lower(trim(p_owner_email)),
       COALESCE(NULLIF(trim(p_owner_display_name), ''), 'Firm Owner'), 'active'),
    (v_agent,  p_new_tenant, 'agent',  'claude', 'Claude', 'active');

  -- Clone tenant zero's seven core registries with fresh ids (the 0072 pattern).
  FOREACH t IN ARRAY registries LOOP
    SELECT
      string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
      string_agg(CASE
        WHEN column_name = 'id'        THEN 'gen_random_uuid()'
        WHEN column_name = 'tenant_id' THEN quote_literal(p_new_tenant) || '::uuid'
        ELSE quote_ident(column_name) END, ', ' ORDER BY ordinal_position)
    INTO cols, sel
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t;

    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM public.%I WHERE tenant_id = %L '
      || 'AND NOT EXISTS (SELECT 1 FROM public.%I b WHERE b.tenant_id = %L)',
      t, cols, sel, t, zero, t, p_new_tenant);
  END LOOP;

  -- Repoint cloned intra-registry entity-kind references (attribute.on_entity_kind_id,
  -- relationship source/target, judgment/outcome about_entity_kind_id, entity
  -- parent_kind_id) from tenant zero's entity kinds to THIS tenant's same-named
  -- kinds, so a cloned tenant never holds a cross-tenant pointer (ADR 0046).
  PERFORM private.cp_remap_entity_kind_refs(p_new_tenant);

  -- A bootstrap action row, then RBAC + owner role (the 0078 recipe).
  SELECT id INTO v_kind FROM public.action_kind_definition
   WHERE tenant_id = p_new_tenant AND kind_name = 'system.bootstrap'
     AND (valid_to IS NULL OR valid_to > now()) LIMIT 1;
  IF v_kind IS NOT NULL THEN
    v_action := gen_random_uuid();
    INSERT INTO public.action (id, tenant_id, action_kind_id, actor_id, intent_kind,
                               autonomy_tier, hlc_physical_time, hlc_logical_counter,
                               hlc_source_id, payload)
    VALUES (v_action, p_new_tenant, v_kind, v_system, 'enforcement', 'autonomous',
            now(), 0, v_system, '{}'::jsonb);
    PERFORM private.provision_firm_rbac(p_new_tenant, v_action);
    PERFORM private.assign_actor_role(p_new_tenant, v_action, v_owner, 'firm.super_admin');
  END IF;

  RETURN v_owner;
END $$;

-- The SOLE writer of tenant.status (tenant has no broad UPDATE policy). Guarded.
CREATE OR REPLACE FUNCTION private.cp_set_tenant_status(
  p_platform_actor uuid, p_tenant_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
BEGIN
  IF NOT private.is_platform_admin(p_platform_actor) THEN
    RAISE EXCEPTION 'not a platform admin';
  END IF;
  IF p_status NOT IN ('active', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'invalid tenant status: %', p_status;
  END IF;
  -- Never let the platform tenant itself be suspended/archived.
  IF p_tenant_id = '00000000-0000-0000-00FF-000000000001'::uuid THEN
    RAISE EXCEPTION 'the platform tenant cannot change status';
  END IF;
  UPDATE public.tenant SET status = p_status WHERE id = p_tenant_id;
END $$;

-- Resolve a verified Google email to its platform-admin actor at admin sign-in.
-- This is the admin-session bootstrap (analogous to auth_resolve_api_key): it
-- runs BEFORE a session exists, so it is NOT guarded by is_platform_admin — the
-- email match against an ACTIVE platform_admin row IS the gate. The email is
-- already proven by the Google OAuth exchange. Returns at most one row.
CREATE OR REPLACE FUNCTION private.cp_resolve_admin_by_email(p_email text)
RETURNS TABLE (actor_id uuid, tenant_id uuid, display_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pa.actor_id, pa.tenant_id, a.display_name
  FROM public.platform_admin pa
  JOIN public.actor a ON a.id = pa.actor_id
  WHERE lower(pa.email) = lower(p_email)
    AND pa.revoked_at IS NULL
    AND a.status = 'active'
  LIMIT 1
$$;

-- Grants: read/lifecycle functions are callable by the non-owner app role; the
-- guard inside each blocks non-admins. anon never reaches them.
REVOKE ALL ON FUNCTION private.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cp_list_tenants(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cp_get_tenant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cp_platform_actor_for(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cp_audit(uuid, text, uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cp_audit_log(uuid, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cp_bootstrap_tenant(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cp_set_tenant_status(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cp_resolve_admin_by_email(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.cp_resolve_admin_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_platform_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_list_tenants(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_get_tenant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_platform_actor_for(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_audit(uuid, text, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_audit_log(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_bootstrap_tenant(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cp_set_tenant_status(uuid, uuid, text) TO authenticated;

SELECT public.sync_migration_history();
