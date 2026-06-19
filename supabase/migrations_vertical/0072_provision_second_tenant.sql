-- =============================================================================
-- Migration 0072: Provision a second tenant (S9 — Tenancy & RBAC, WP9.1)
--
-- The substrate has shipped single-tenant ("Exsto Dev" / Pacheco Law,
-- 00000000-0000-0000-0000-000000000001). Tenancy isolation is already enforced
-- at the DB by RLS on app.tenant_id (ADR 0001) — what was missing was a SECOND
-- tenant to prove that isolation across. This migration stands up a real second
-- firm ("Liberty Legal", 00000000-0000-0000-0000-000000000002) the bootstrap
-- way (exsto-bootstrap-tenant): tenant row → system/owner/agent actors → the
-- tenant's own kind definitions (kinds are per-tenant; a kind defined for one
-- tenant does not exist for another).
--
-- Tenant B's vocabulary is cloned from tenant zero's seven core registries
-- (action / entity / attribute / relationship / event / judgment / outcome
-- kinds — none of which carry an action_id, so they clone without a bootstrap
-- action). Runtime config registries that DO carry action_id (workflow,
-- notification_route, …) are intentionally NOT cloned: they are created through
-- the action layer at runtime, not seeded, and are not needed to prove
-- isolation or to act on the core primitives. Tenant B's UUIDs match the
-- convention already used by scripts/adversarial-audit.mjs (TENANT_B / System B).
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING for the fixed rows, and a
-- NOT EXISTS guard per registry so re-running clones nothing twice. No writes to
-- substrate state tables (entity/attribute/…) — only the tenant, its actors, and
-- definition rows, all of which a migration may seed (exsto-substrate-migration).
-- =============================================================================

-- Owner-run migration bypasses RLS, but set the context defensively so any
-- tenant-scoped WITH CHECK policies are satisfied.
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000002', false);

-- -----------------------------------------------------------------------------
-- Tenant B
-- -----------------------------------------------------------------------------
INSERT INTO tenant (id, name, status) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Liberty Legal', 'active')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Actors for tenant B: system (background jobs / seed), the owning attorney
-- (admin), and an AI agent. external_id of a human actor IS their sign-in email
-- (identity.ts resolves the actor by external_id), so the owner is reachable by
-- the normal Google sign-in path once their Google account uses this address.
-- -----------------------------------------------------------------------------
INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status) VALUES
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000002', 'system', 'system',                  'System',       'active'),
  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000002', 'human',  'owner@libertylegal.test', 'Dana Liberty', 'active'),
  ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000002', 'agent',  'claude',                  'Claude',       'active')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Clone tenant zero's seven core kind registries into tenant B with fresh ids.
-- These registries carry no action_id, so the clone needs no bootstrap action.
-- The per-registry NOT EXISTS guard makes the whole block idempotent.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  zero uuid := '00000000-0000-0000-0000-000000000001';
  tb   uuid := '00000000-0000-0000-0000-000000000002';
  t    text;
  cols text;
  sel  text;
  registries text[] := ARRAY[
    'action_kind_definition',
    'entity_kind_definition',
    'attribute_kind_definition',
    'relationship_kind_definition',
    'event_kind_definition',
    'judgment_kind_definition',
    'outcome_kind_definition'
  ];
BEGIN
  FOREACH t IN ARRAY registries LOOP
    SELECT
      string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
      string_agg(
        CASE
          WHEN column_name = 'id'        THEN 'gen_random_uuid()'
          WHEN column_name = 'tenant_id' THEN quote_literal(tb) || '::uuid'
          ELSE quote_ident(column_name)
        END, ', ' ORDER BY ordinal_position)
    INTO cols, sel
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t;

    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM public.%I WHERE tenant_id = %L '
      || 'AND NOT EXISTS (SELECT 1 FROM public.%I b WHERE b.tenant_id = %L)',
      t, cols, sel, t, zero, t, tb
    );
  END LOOP;
END $$;

-- Self-record (invariant 12).
SELECT public.sync_migration_history();
