-- =============================================================================
-- Vertical migration 0162: paralegal scope — exclude legal.firm.set_profile
--
-- BUILDER-UX-3 review fix (policy, precedent-based). The RBAC role ladder
-- (0078, re-pinned in 0079) gives firm.paralegal action_kinds of
-- '["*", …!-exclusions]', and '!legal.firm.set_default_rate' is the standing
-- precedent: firm-level authority is withheld from support staff even though
-- they keep full practice access. The firm identity that lands on generated
-- legal documents (legal.firm.set_profile, migration 0161 — firm name/address/
-- phone/email) is the same class of firm-level setting as the default rate, so
-- it gets the same exclusion.
--
-- Mechanism (copies 0079 + 0136): re-define private.provision_firm_rbac with
-- 0079's body byte-for-byte plus the new exclusion — CREATE OR REPLACE keeps it
-- idempotent, and every future tenant provisioned through it (0101 control
-- plane, 0105 sandbox) gets the amended rung automatically — then re-PERFORM it
-- for each tenant that already has the ladder (the function UPSERTs by
-- scope_name, so re-running amends the existing scope rows in place). The
-- per-tenant config.change action row for provenance follows 0136's shape.
-- Tenants whose paralegal scope already carries the exclusion are skipped, so
-- re-running this migration is a no-op.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

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
        'Full practice access; cannot issue/send invoices, set the firm rate or firm profile, or administer the firm.',
        '["*","!invoice.issue","!invoice.send","!legal.firm.set_default_rate","!legal.firm.set_profile"]'::jsonb,
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

-- Amend the ladder in every tenant that already has it (tenant-zero and
-- siblings alike): re-PERFORM the provisioning UPSERT under a per-tenant
-- config.change action row (0136's provenance shape).
DO $$
DECLARE
  t record;
  v_action uuid;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id FROM permission_scope_definition
    WHERE scope_name = 'firm.paralegal' AND status = 'active'
      AND (valid_to IS NULL OR valid_to > now())
  LOOP
    -- Already amended (idempotent re-run) → nothing to record, nothing to do.
    IF EXISTS (
      SELECT 1 FROM permission_scope_definition
      WHERE tenant_id = t.tenant_id AND scope_name = 'firm.paralegal'
        AND status = 'active' AND (valid_to IS NULL OR valid_to > now())
        AND action_kinds @> '["!legal.firm.set_profile"]'::jsonb
    ) THEN
      CONTINUE;
    END IF;

    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    v_action := NULL;
    INSERT INTO action (id, tenant_id, actor_id, action_kind_id, intent_kind, autonomy_tier,
                        hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
    SELECT gen_random_uuid(), t.tenant_id, a.id, akd.id, 'enforcement', 'autonomous',
           now(), 0, a.id, '{"reason": "0162_paralegal_scope_firm_profile"}'::jsonb
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

    PERFORM private.provision_firm_rbac(t.tenant_id, v_action);
  END LOOP;
END $$;
