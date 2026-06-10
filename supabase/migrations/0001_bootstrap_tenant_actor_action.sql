-- =============================================================================
-- Migration 0001: Bootstrap
-- Creates the four foundational tables: tenant, actor, action_kind_definition,
-- and action. Establishes the tenancy invariant (ADR 0001) via RLS and the
-- append-only action log invariant (ADR 0014) via deny-update/delete policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- tenant
-- The registry of tenants. Self-referential for RLS: a tenant can only see
-- its own row. Inserts/updates/deletes happen through admin paths (service
-- role), not user-facing code, so no INSERT/UPDATE/DELETE policies are
-- defined.
-- -----------------------------------------------------------------------------

CREATE TABLE tenant (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_self_select ON tenant
  FOR SELECT
  USING (id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- actor
-- Who or what performs actions. Tenant-scoped.
-- -----------------------------------------------------------------------------

CREATE TABLE actor (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenant(id),
  actor_type   text        NOT NULL
                           CHECK (actor_type IN ('human', 'integration', 'agent', 'system')),
  external_id  text,
  display_name text        NOT NULL,
  status       text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'inactive')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX actor_tenant_id_idx ON actor (tenant_id);

ALTER TABLE actor ENABLE ROW LEVEL SECURITY;

CREATE POLICY actor_tenant_isolation_select ON actor
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY actor_tenant_isolation_insert ON actor
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY actor_tenant_isolation_update ON actor
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- action_kind_definition
-- Schema-as-data registry for action kinds (ADR 0012). Each row is a version
-- of an action kind definition (ADR 0017). The kind_name groups versions of
-- the same logical kind; valid_from/valid_to track temporal validity.
-- -----------------------------------------------------------------------------

CREATE TABLE action_kind_definition (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL REFERENCES tenant(id),
  kind_name                text        NOT NULL,
  display_name             text        NOT NULL,
  description              text,
  default_autonomy_tier    text        NOT NULL
                                       CHECK (default_autonomy_tier IN ('autonomous', 'notify', 'approve', 'suggest')),
  reversibility            text        NOT NULL
                                       CHECK (reversibility IN ('fully_reversible', 'reversible_with_state_decay', 'reversible_with_external_caveats', 'irreversible')),
  reverse_action_kind_name text,
  requires_reasoning_trace boolean     NOT NULL DEFAULT false,
  valid_from               timestamptz NOT NULL DEFAULT now(),
  valid_to                 timestamptz,
  status                   text        NOT NULL DEFAULT 'active'
                                       CHECK (status IN ('active', 'deprecated')),
  recorded_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX action_kind_definition_tenant_id_idx
  ON action_kind_definition (tenant_id);

CREATE INDEX action_kind_definition_lookup_idx
  ON action_kind_definition (tenant_id, kind_name, valid_from DESC);

ALTER TABLE action_kind_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY akd_tenant_isolation_select ON action_kind_definition
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY akd_tenant_isolation_insert ON action_kind_definition
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY akd_tenant_isolation_update ON action_kind_definition
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- action
-- The action log. Append-only (ADR 0014): UPDATE and DELETE are denied via
-- RLS policies returning false. Captures every change to substrate state with
-- actor, intent, autonomy tier, and HLC ordering (ADR 0015).
-- -----------------------------------------------------------------------------

CREATE TABLE action (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_kind_id      uuid        NOT NULL REFERENCES action_kind_definition(id),
  actor_id            uuid        NOT NULL REFERENCES actor(id),
  intent_kind         text        NOT NULL
                                  CHECK (intent_kind IN ('correction', 'reflection', 'adjustment', 'override', 'exploration', 'enforcement', 'automatic_sync', 'unknown')),
  autonomy_tier       text        NOT NULL
                                  CHECK (autonomy_tier IN ('autonomous', 'notify', 'approve', 'suggest')),
  reasoning_trace_id  uuid,        -- no FK yet; reasoning_trace table doesn't exist
  target_kind         text,
  target_id           uuid,
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  effects             jsonb,
  hlc_physical_time   timestamptz NOT NULL,
  hlc_logical_counter integer     NOT NULL,
  hlc_source_id       uuid        NOT NULL,
  previous_hash       bytea,       -- per-tenant hash chain (ADR 0018), off by default
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX action_tenant_id_idx
  ON action (tenant_id);

CREATE INDEX action_recorded_at_idx
  ON action (tenant_id, recorded_at DESC);

CREATE INDEX action_actor_idx
  ON action (tenant_id, actor_id);

CREATE INDEX action_kind_idx
  ON action (tenant_id, action_kind_id);

CREATE INDEX action_target_idx
  ON action (tenant_id, target_kind, target_id)
  WHERE target_id IS NOT NULL;

ALTER TABLE action ENABLE ROW LEVEL SECURITY;

CREATE POLICY action_tenant_isolation_select ON action
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY action_tenant_isolation_insert ON action
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Append-only: deny UPDATE and DELETE structurally.
CREATE POLICY action_no_update ON action
  FOR UPDATE
  USING (false);

CREATE POLICY action_no_delete ON action
  FOR DELETE
  USING (false);
