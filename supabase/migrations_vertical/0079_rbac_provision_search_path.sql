-- =============================================================================
-- Migration 0079: pin search_path on the two RBAC provisioning functions
--
-- Follow-up to 0078. The Supabase security linter flags
-- `function_search_path_mutable` on the two plpgsql functions 0078 added without
-- a fixed search_path (`private.provision_firm_rbac`, `private.assign_actor_role`).
-- Every other RBAC helper (0073/0078) already pins
-- `SET search_path = private, public, pg_temp`; these two were the exception.
-- They are reusable per-tenant provisioning helpers (future new-tenant migrations
-- PERFORM them), so a fixed search_path is the right hardening even though they
-- run SECURITY INVOKER from owner/migration context today.
--
-- 0078 is already applied + ledgered, so its checksum is immutable — this is the
-- forward-only fix. Bodies are byte-for-byte identical to 0078 except the added
-- SET clause; CREATE OR REPLACE makes it idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.provision_firm_rbac(p_tenant uuid, p_action_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = private, public, pg_temp
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
  -- rank: the ladder's authority order, persisted as data (read by the
  -- rank-ceiling RLS and the application layer alike — one source of truth).
  FOR s IN
    SELECT * FROM (VALUES
      ('firm.super_admin', 'Super Admin (platform owner)',
        'Full access across the firm, plus authority over admins. The platform owner.',
        '["*"]'::jsonb, '["*"]'::jsonb, 100),
      ('firm.admin', 'Admin (Head Attorney)',
        'Full access: matters, clients, billing, firm settings, and user management.',
        '["*"]'::jsonb, '["*"]'::jsonb, 80),
      ('firm.attorney', 'Attorney',
        'Full practice access incl. billing; cannot manage users or define firm kinds/workflows/RBAC.',
        '["*"]'::jsonb, '["*"]'::jsonb, 50),
      ('firm.paralegal', 'Paralegal',
        'Full practice access; cannot issue/send invoices, set the firm rate, or administer the firm.',
        '["*","!invoice.issue","!invoice.send","!legal.firm.set_default_rate"]'::jsonb,
        '["*"]'::jsonb, 30)
    ) AS t(scope_name, display_name, description, action_kinds, entity_kinds, rank)
  LOOP
    UPDATE permission_scope_definition
       SET display_name = s.display_name, description = s.description,
           action_kinds = s.action_kinds, entity_kinds = s.entity_kinds, rank = s.rank, status = 'active'
     WHERE tenant_id = p_tenant AND scope_name = s.scope_name
       AND (valid_to IS NULL OR valid_to > now());
    IF NOT FOUND THEN
      INSERT INTO permission_scope_definition
        (id, tenant_id, action_id, scope_name, display_name, description,
         action_kinds, entity_kinds, attribute_kinds, row_filter_expression, rank, status)
      VALUES (gen_random_uuid(), p_tenant, p_action_id, s.scope_name, s.display_name, s.description,
              s.action_kinds, s.entity_kinds, '[]'::jsonb, '{}'::jsonb, s.rank, 'active');
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

CREATE OR REPLACE FUNCTION private.assign_actor_role(p_tenant uuid, p_action_id uuid, p_actor uuid, p_scope_name text)
RETURNS void
LANGUAGE plpgsql
SET search_path = private, public, pg_temp
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
  -- active, leave it untouched so re-running doesn't churn assignment rows.
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

-- Self-record (invariant 12).
SELECT public.sync_migration_history();
