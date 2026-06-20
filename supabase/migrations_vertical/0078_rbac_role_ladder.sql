-- =============================================================================
-- Migration 0078: the firm RBAC role ladder (S9 — roles + the P1/P2 fixes)
--
-- 0073 made scopes BITE (RESTRICTIVE RLS in Postgres); 0074 seeded a 2-tier
-- starter set (firm.admin / firm.paralegal) for tenant zero. This migration
-- turns that into the role ladder Joe asked for — one head-attorney ADMIN and a
-- platform SUPER ADMIN per firm — and closes the security holes the 2-tier
-- starter left open.
--
--   super_admin  platform owner; full access + authority over admins
--   admin        the head attorney; full access incl. billing + user management
--   attorney     full practice incl. billing; NO user management / firm RBAC
--   paralegal    matters & clients; NO billing, NO administration
--
-- THREE corrections to the as-shipped (and as-on-prod, but NOT yet in the
-- ledger) 0073/0074 behaviour:
--
--   P1  Zero-scope = unrestricted was the whole model in 0073. For a HUMAN that
--       is a privilege-escalation hole: a human with no role had FULL access and
--       could self-grant firm.admin. Fix: humans are ALWAYS scope-restricted
--       (a human with no scope can do nothing); non-human actors (system / agent
--       / worker) keep the opt-in model so background jobs and the seed path
--       keep working. An UNKNOWN actor id also fails closed (restricted). PLUS an
--       escalation FLOOR: the privilege-granting / firm-defining actions
--       (legal.user.*, every %.define governance verb, role.assign,
--       actor_scope.assign) require an admin scope regardless of any wildcard —
--       defense in depth that can only ever DENY, never grant.
--
--   P2a 0074's firm.paralegal listed action `legal.matter.create`, which does
--       not exist (the real kind is `matter.open`) — so a paralegal could not
--       actually open a matter. The new scopes use a wildcard with `!`-prefixed
--       EXCLUSIONS, so a paralegal gets every practice action except the few
--       billing ones, and this whole class of "scope lists a kind name that
--       drifted" bug goes away.
--
--   P2b A re-`invite` of an existing user silently re-bound them to the default
--       (paralegal) role — a silent demotion of an admin. Fixed in the handler
--       (preserve the current role when no role is specified for an existing
--       user); the rank guard in the API stops cross-rank changes.
--
-- Scope grammar (interpreted by the gate functions below):
--   action_kinds / entity_kinds are jsonb arrays of names. `"*"` = all. A
--   `"!name"` entry EXCLUDES that name even when `"*"` is present. Grant iff
--   some active scope lists it (or `*`) AND that same scope does not `!`-exclude
--   it. Multi-scope actors get the UNION (admin scope wins over a restricted one).
--
-- The new scopes/roles are provisioned for EVERY tenant via a reusable function
-- (private.provision_firm_rbac) so a new firm comes up with the full ladder; new
-- tenant migrations should PERFORM it. We UPSERT (correct in place) rather than
-- version, because 0074 is not in the ledger and was never really released — the
-- only assignments in the wild are the seed owner + a test actor.
--
-- Idempotent: CREATE OR REPLACE for functions, fixed UUIDs + UPSERT/ON CONFLICT
-- for data, NOT EXISTS guards for the (optional) second tenant.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- -----------------------------------------------------------------------------
-- Gate helpers (CREATE OR REPLACE the 0073 versions).
-- -----------------------------------------------------------------------------

-- A human is ALWAYS restricted (must hold an explicit role/scope) — that is the
-- P1 fix. An UNKNOWN actor (no row for this id) is ALSO restricted: fail closed,
-- so a forged/garbage app.actor_id cannot act unrestricted. Only an EXISTING
-- NON-human actor (system / agent / worker) keeps the opt-in model: zero scopes
-- => unrestricted, so background jobs and the seed path keep working.
CREATE OR REPLACE FUNCTION private.actor_is_scope_restricted(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.actor a WHERE a.id = p_actor_id)        -- unknown => restricted
    OR EXISTS (SELECT 1 FROM public.actor a WHERE a.id = p_actor_id AND a.actor_type = 'human')
    OR EXISTS (
      SELECT 1 FROM public.actor_scope_assignment asa
      WHERE asa.actor_id = p_actor_id AND (asa.valid_to IS NULL OR asa.valid_to > now())
    );
$$;

-- Does the actor hold an admin-marked scope? Admin authority is keyed on the
-- scope NAME (firm.admin / firm.super_admin), NOT on "has a `*` wildcard" —
-- the attorney/paralegal scopes are wildcards too, and must not read as admin.
CREATE OR REPLACE FUNCTION private.actor_has_admin_scope(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.actor_scope_assignment asa
    JOIN public.permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
    WHERE asa.actor_id = p_actor_id
      AND (asa.valid_to IS NULL OR asa.valid_to > now())
      AND (psd.valid_to IS NULL OR psd.valid_to > now())
      AND psd.scope_name IN ('firm.admin', 'firm.super_admin')
  );
$$;

-- Is this action one that grants access OR reshapes the firm's configuration?
-- Those are the escalation surface: they may run ONLY for an admin scope,
-- regardless of any wildcard. This is a security FLOOR (it only ever denies).
-- Covered:
--   * legal.user.*            — firm user management
--   * %.define                — the schema-as-data / governance DEFINITION verbs
--                               (kind.define, role.define, permission_scope.define,
--                               workflow.define, trigger.define, policy.define,
--                               collection.define, hierarchy.define,
--                               conflict_rule.define, notification_route.define,
--                               integration_mapping.define). Per CLAUDE.md hard
--                               rule 8 these ARE the firm's configuration; an
--                               attorney (a wildcard practice role) must not mint
--                               kinds or redefine firm-wide automation.
--   * role.assign / actor_scope.assign — the direct privilege-grant verbs.
-- NOT covered on purpose: config.change is the generic configuration RECORDER
-- (used by, e.g., connecting an integration in Settings); flooring it would
-- block ordinary practice config for non-admins. The privilege-granting RBAC
-- definitions above are what must be admin-only.
CREATE OR REPLACE FUNCTION private.action_is_escalation(p_action_kind_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.action_kind_definition akd
    WHERE akd.id = p_action_kind_id
      AND (
        akd.kind_name LIKE 'legal.user.%'
        OR akd.kind_name LIKE '%.define'
        OR akd.kind_name IN ('role.assign', 'actor_scope.assign')
      )
  );
$$;

-- May this actor run an action of the given kind? In-scope (wildcard or listed,
-- and not `!`-excluded) AND, for escalation actions, holds an admin scope.
CREATE OR REPLACE FUNCTION private.actor_may_run_action(p_actor_id uuid, p_action_kind_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_actor_id IS NULL THEN true
    WHEN NOT private.actor_is_scope_restricted(p_actor_id) THEN true
    ELSE (
      EXISTS (
        SELECT 1
        FROM public.actor_scope_assignment asa
        JOIN public.permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
        JOIN public.action_kind_definition akd ON akd.id = p_action_kind_id
        WHERE asa.actor_id = p_actor_id
          AND (asa.valid_to IS NULL OR asa.valid_to > now())
          AND (psd.valid_to IS NULL OR psd.valid_to > now())
          AND (psd.action_kinds ? '*' OR psd.action_kinds ? akd.kind_name)
          AND NOT (psd.action_kinds ? ('!' || akd.kind_name))
      )
      AND (
        NOT private.action_is_escalation(p_action_kind_id)
        OR private.actor_has_admin_scope(p_actor_id)
      )
    )
  END;
$$;

-- May this actor read entities of the given kind? In-scope (wildcard or listed,
-- and not `!`-excluded). No escalation floor on reads.
CREATE OR REPLACE FUNCTION private.actor_may_read_entity_kind(p_actor_id uuid, p_entity_kind_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_actor_id IS NULL THEN true
    WHEN NOT private.actor_is_scope_restricted(p_actor_id) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.actor_scope_assignment asa
      JOIN public.permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      JOIN public.entity_kind_definition ekd ON ekd.id = p_entity_kind_id
      WHERE asa.actor_id = p_actor_id
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())
        AND (psd.entity_kinds ? '*' OR psd.entity_kinds ? ekd.kind_name)
        AND NOT (psd.entity_kinds ? ('!' || ekd.kind_name))
    )
  END;
$$;

-- (private.actor_may_read_entity and current_actor_id are unchanged from 0073.)

GRANT EXECUTE ON FUNCTION private.actor_has_admin_scope(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.action_is_escalation(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Reusable per-tenant provisioning of the 4-tier ladder. UPSERT by name so it
-- both seeds a fresh tenant and corrects the unreleased 0074 starter set.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.provision_firm_rbac(p_tenant uuid, p_action_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  s record;
  r record;
BEGIN
  -- Make tenant-scoped writes safe to run from any per-tenant caller (this fn is
  -- meant to be PERFORMed by future new-tenant migrations too). Transaction-local.
  PERFORM set_config('app.tenant_id', p_tenant::text, true);

  -- "no billing" for the paralegal is a complete WRITE restriction (they cannot
  -- issue/send invoices or set the firm rate). Reads are full practice access:
  -- we do NOT try to hide billing at the entity layer, because billing data also
  -- lives in un-scoped `event` rows — an entity-only `!invoice` exclusion would
  -- be a false guarantee. Read-side billing isolation needs event-level scoping
  -- (a substrate-wide follow-up), tracked separately.
  FOR s IN
    SELECT * FROM (VALUES
      ('firm.super_admin', 'Super Admin (platform owner)',
        'Full access across the firm, plus authority over admins. The platform owner.',
        '["*"]'::jsonb, '["*"]'::jsonb),
      ('firm.admin', 'Admin (Head Attorney)',
        'Full access: matters, clients, billing, firm settings, and user management.',
        '["*"]'::jsonb, '["*"]'::jsonb),
      ('firm.attorney', 'Attorney',
        'Full practice access incl. billing; cannot manage users or define firm kinds/workflows/RBAC.',
        '["*"]'::jsonb, '["*"]'::jsonb),
      ('firm.paralegal', 'Paralegal',
        'Full practice access; cannot issue/send invoices, set the firm rate, or administer the firm.',
        '["*","!invoice.issue","!invoice.send","!legal.firm.set_default_rate"]'::jsonb,
        '["*"]'::jsonb)
    ) AS t(scope_name, display_name, description, action_kinds, entity_kinds)
  LOOP
    UPDATE permission_scope_definition
       SET display_name = s.display_name, description = s.description,
           action_kinds = s.action_kinds, entity_kinds = s.entity_kinds, status = 'active'
     WHERE tenant_id = p_tenant AND scope_name = s.scope_name
       AND (valid_to IS NULL OR valid_to > now());
    IF NOT FOUND THEN
      INSERT INTO permission_scope_definition
        (id, tenant_id, action_id, scope_name, display_name, description,
         action_kinds, entity_kinds, attribute_kinds, row_filter_expression, status)
      VALUES (gen_random_uuid(), p_tenant, p_action_id, s.scope_name, s.display_name, s.description,
              s.action_kinds, s.entity_kinds, '[]'::jsonb, '{}'::jsonb, 'active');
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      ('firm.super_admin', 'Super Admin',
        'Platform owner. Full access plus authority over admins.', '["firm.super_admin"]'::jsonb),
      ('firm.admin', 'Admin (Head Attorney)',
        'The head attorney. Full administrative access to the firm.', '["firm.admin"]'::jsonb),
      ('firm.attorney', 'Attorney',
        'Practicing attorney: full matter, client, and billing work.', '["firm.attorney"]'::jsonb),
      ('firm.paralegal', 'Paralegal',
        'Support staff: full practice access, no billing or administration.', '["firm.paralegal"]'::jsonb)
    ) AS t(role_name, display_name, description, scopes)
  LOOP
    UPDATE role_definition
       SET display_name = r.display_name, description = r.description,
           default_permission_scopes = r.scopes, status = 'active'
     WHERE tenant_id = p_tenant AND role_name = r.role_name
       AND (valid_to IS NULL OR valid_to > now());
    IF NOT FOUND THEN
      INSERT INTO role_definition
        (id, tenant_id, action_id, role_name, display_name, description, default_permission_scopes, status)
      VALUES (gen_random_uuid(), p_tenant, p_action_id, r.role_name, r.display_name, r.description, r.scopes, 'active');
    END IF;
  END LOOP;

  -- Retire the legacy firm.owner role (0074): it mapped to the same scope set as
  -- firm.admin, which would make role-from-scopes derivation ambiguous.
  UPDATE role_definition SET valid_to = now()
   WHERE tenant_id = p_tenant AND role_name = 'firm.owner' AND (valid_to IS NULL OR valid_to > now());
END $$;

-- Bind an actor to exactly one role's scope (close prior bindings first) — the
-- same bitemporal "close then insert" the runtime handler does.
CREATE OR REPLACE FUNCTION private.assign_actor_role(p_tenant uuid, p_action_id uuid, p_actor uuid, p_scope_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_scope uuid;
BEGIN
  -- No-op for an actor that doesn't exist in this tenant: the backfill targets
  -- include runtime-created actors (sign-ins/invites) that are present on prod
  -- but NOT in the fresh-DB seed used by CI. Skipping keeps the migration
  -- idempotent across both, instead of FK-failing on CI.
  IF NOT EXISTS (SELECT 1 FROM actor WHERE id = p_actor AND tenant_id = p_tenant) THEN
    RETURN;
  END IF;
  SELECT id INTO v_scope FROM permission_scope_definition
   WHERE tenant_id = p_tenant AND scope_name = p_scope_name AND (valid_to IS NULL OR valid_to > now())
   ORDER BY recorded_at DESC LIMIT 1;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'assign_actor_role: no active scope % in tenant %', p_scope_name, p_tenant;
  END IF;
  -- Idempotent: if the actor already holds exactly this scope (and nothing else)
  -- active, leave it untouched so re-running 0078 doesn't churn assignment rows.
  IF EXISTS (
    SELECT 1 FROM actor_scope_assignment asa
     WHERE asa.tenant_id = p_tenant AND asa.actor_id = p_actor AND asa.valid_to IS NULL
       AND asa.permission_scope_definition_id = v_scope
  ) AND NOT EXISTS (
    SELECT 1 FROM actor_scope_assignment asa
     WHERE asa.tenant_id = p_tenant AND asa.actor_id = p_actor AND asa.valid_to IS NULL
       AND asa.permission_scope_definition_id <> v_scope
  ) THEN
    RETURN;
  END IF;
  UPDATE actor_scope_assignment SET valid_to = now()
   WHERE tenant_id = p_tenant AND actor_id = p_actor AND valid_to IS NULL;
  INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
  VALUES (gen_random_uuid(), p_tenant, p_action_id, p_actor, v_scope);
END $$;

-- =============================================================================
-- Tenant zero (Pacheco Law): provision the ladder + backfill existing humans.
-- =============================================================================
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                    hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
VALUES (
  '00000000-0000-0000-0078-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0013-000000000001',           -- system.bootstrap (tenant zero)
  '00000000-0000-0000-0001-000000000001',           -- system actor (tenant zero)
  'enforcement', 'autonomous', now(), 0, '00000000-0000-0000-0001-000000000001', '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

SELECT private.provision_firm_rbac(
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0078-000000000001'
);

-- Backfill every existing human into a role (none may stay zero-scope now that
-- humans are always restricted). Joe (both sign-in identities) = super_admin;
-- Juan Carlos = attorney; the legacy "Second User" = paralegal.
SELECT private.assign_actor_role('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0078-000000000001',
  '00000000-0000-0000-0001-000000000002', 'firm.super_admin');  -- Joe Pacheco (pachecojoseph824@gmail.com)
SELECT private.assign_actor_role('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0078-000000000001',
  'e193d11c-9204-4068-8d01-0613ec1a5095', 'firm.super_admin');  -- Joe Pacheco (joe@revenueinstruments.com)
SELECT private.assign_actor_role('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0078-000000000001',
  'a392ee27-08dc-4845-9990-01af013d5dab', 'firm.attorney');     -- Juan Carlos
SELECT private.assign_actor_role('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0078-000000000001',
  '00000000-0000-0000-0001-000000000003', 'firm.paralegal');   -- Second User (no email; cannot sign in)

-- =============================================================================
-- Tenant B (Liberty Legal), if present: prove the ladder in a second firm.
-- Dana Liberty = admin (head attorney). A DISTINCT platform identity holds
-- super_admin here — NOT Joe's real email: lookupActorByEmail is cross-tenant +
-- most-recent-wins, so reusing Joe's email would hijack his sign-in to this
-- tenant. Making Joe a super_admin in additional REAL firms is the tenant-picker
-- follow-up (one Google login -> one firm until then).
-- =============================================================================
DO $$
DECLARE
  tb       uuid := '00000000-0000-0000-0000-000000000002';
  v_kind   uuid;
  v_sys    uuid := '00000000-0000-0000-0002-000000000001';  -- system actor (tenant B)
  v_action uuid := '00000000-0000-0000-0078-000000000002';
  v_super  uuid := '00000000-0000-0000-0078-0000000000b1';  -- platform super-admin actor (tenant B)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = tb) THEN RETURN; END IF;

  -- Use tenant B's context for its writes (line 298 left the GUC on tenant zero).
  PERFORM set_config('app.tenant_id', tb::text, true);

  SELECT id INTO v_kind FROM action_kind_definition
   WHERE tenant_id = tb AND kind_name = 'system.bootstrap' AND (valid_to IS NULL OR valid_to > now())
   LIMIT 1;
  IF v_kind IS NULL THEN RETURN; END IF;  -- tenant B not fully provisioned; skip

  INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                      hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
  VALUES (v_action, tb, v_kind, v_sys, 'enforcement', 'autonomous', now(), 0, v_sys, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  PERFORM private.provision_firm_rbac(tb, v_action);

  PERFORM private.assign_actor_role(tb, v_action, '00000000-0000-0000-0002-000000000002', 'firm.admin');

  INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
  VALUES (v_super, tb, 'human', 'platform-superadmin@exsto.dev', 'Platform Super Admin', 'active')
  ON CONFLICT (id) DO NOTHING;
  PERFORM private.assign_actor_role(tb, v_action, v_super, 'firm.super_admin');
END $$;

-- Self-record (invariant 12).
SELECT public.sync_migration_history();
