-- =============================================================================
-- Migration 0010: Configuration and capability primitives
-- configuration_change, migration_job, schema_migration,
-- system_capability_registry, substrate_capability_metric, substrate_known_issue.
-- Makes configuration history and substrate self-knowledge first-class data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- configuration_change  (every config modification, auditable; append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE configuration_change (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id),
  action_id         uuid        NOT NULL REFERENCES action(id),
  target_table      text        NOT NULL,
  target_id         uuid,
  change_kind       text        NOT NULL
                                CHECK (change_kind IN ('create', 'update', 'deprecate')),
  before_value      jsonb,
  after_value       jsonb,
  change_reason     text,
  blast_radius      integer,
  reversal_status   text        NOT NULL DEFAULT 'not_reversed'
                                CHECK (reversal_status IN ('not_reversed', 'reversed', 'irreversible')),
  authoring_actor_id uuid       NOT NULL REFERENCES actor(id),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX configuration_change_tenant_idx ON configuration_change (tenant_id);
CREATE INDEX configuration_change_target_idx
  ON configuration_change (tenant_id, target_table, target_id);

ALTER TABLE configuration_change ENABLE ROW LEVEL SECURITY;

CREATE POLICY cc_tenant_isolation_select ON configuration_change
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cc_tenant_isolation_insert ON configuration_change
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cc_no_update ON configuration_change FOR UPDATE USING (false);
CREATE POLICY cc_no_delete ON configuration_change FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- migration_job  (schema/data migrations as first-class operations)
-- Insert-only per CLAUDE.md hard rule 3. Status transitions are new rows that
-- reference the prior via supersedes_id; the current state is the head of the
-- supersession chain (job_group_id groups the chain).
-- -----------------------------------------------------------------------------

CREATE TABLE migration_job (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenant(id),
  action_id            uuid        NOT NULL REFERENCES action(id),
  job_group_id         uuid        NOT NULL,
  supersedes_id        uuid        REFERENCES migration_job(id),
  migration_kind       text        NOT NULL
                                   CHECK (migration_kind IN ('schema_evolution', 'tech_stack_change', 'reclassification', 'data_correction')),
  affected_entity_kinds jsonb      NOT NULL DEFAULT '[]'::jsonb,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'running', 'completed', 'failed', 'reversed')),
  reversal_plan        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  summary              text,
  started_at           timestamptz,
  completed_at         timestamptz,
  recorded_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX migration_job_tenant_idx ON migration_job (tenant_id);
CREATE INDEX migration_job_group_idx ON migration_job (tenant_id, job_group_id, recorded_at DESC);
CREATE INDEX migration_job_status_idx ON migration_job (tenant_id, status);

ALTER TABLE migration_job ENABLE ROW LEVEL SECURITY;

CREATE POLICY mj_tenant_isolation_select ON migration_job
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY mj_tenant_isolation_insert ON migration_job
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY mj_no_update ON migration_job FOR UPDATE USING (false);
CREATE POLICY mj_no_delete ON migration_job FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- schema_migration  (event log of canonical schema changes; append-only)
-- Enables answering "when did this attribute kind exist" historically.
-- -----------------------------------------------------------------------------

CREATE TABLE schema_migration (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id),
  action_id         uuid        NOT NULL REFERENCES action(id),
  change_kind       text        NOT NULL
                                CHECK (change_kind IN ('added', 'modified', 'deprecated')),
  target_kind       text        NOT NULL
                                CHECK (target_kind IN ('entity_kind', 'attribute_kind', 'relationship_kind', 'event_kind', 'judgment_kind', 'outcome_kind', 'period_kind')),
  target_kind_name  text        NOT NULL,
  definition_id     uuid,
  details           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX schema_migration_tenant_idx ON schema_migration (tenant_id);
CREATE INDEX schema_migration_target_idx
  ON schema_migration (tenant_id, target_kind, target_kind_name, occurred_at DESC);

ALTER TABLE schema_migration ENABLE ROW LEVEL SECURITY;

CREATE POLICY sm_tenant_isolation_select ON schema_migration
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sm_tenant_isolation_insert ON schema_migration
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sm_no_update ON schema_migration FOR UPDATE USING (false);
CREATE POLICY sm_no_delete ON schema_migration FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- system_capability_registry
-- Materialized snapshot of what the substrate supports for a tenant. One row
-- per tenant, refreshed (mutable). Single source of truth for "what's possible
-- right now?" consumed by MCP capability tools.
-- -----------------------------------------------------------------------------

CREATE TABLE system_capability_registry (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id),
  snapshot    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX system_capability_registry_tenant_unique ON system_capability_registry (tenant_id);

ALTER TABLE system_capability_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY scr_tenant_isolation_select ON system_capability_registry
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY scr_tenant_isolation_insert ON system_capability_registry
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY scr_tenant_isolation_update ON system_capability_registry
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- substrate_capability_metric
-- Quality / coverage / freshness / consistency metrics as data. Schema present
-- from v1; computation deferred (DoD). Append-only observations.
-- -----------------------------------------------------------------------------

CREATE TABLE substrate_capability_metric (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id),
  metric_kind text        NOT NULL
                          CHECK (metric_kind IN ('quality', 'coverage', 'freshness', 'consistency')),
  scope       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  value       numeric,
  computed_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX substrate_capability_metric_tenant_idx ON substrate_capability_metric (tenant_id);
CREATE INDEX substrate_capability_metric_kind_idx
  ON substrate_capability_metric (tenant_id, metric_kind, computed_at DESC);

ALTER TABLE substrate_capability_metric ENABLE ROW LEVEL SECURITY;

CREATE POLICY scm_tenant_isolation_select ON substrate_capability_metric
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY scm_tenant_isolation_insert ON substrate_capability_metric
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY scm_no_update ON substrate_capability_metric FOR UPDATE USING (false);
CREATE POLICY scm_no_delete ON substrate_capability_metric FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- substrate_known_issue  (flagged data-quality concerns; resolution mutable)
-- Lets agents hedge appropriately when querying affected domains.
-- -----------------------------------------------------------------------------

CREATE TABLE substrate_known_issue (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id),
  action_id   uuid        NOT NULL REFERENCES action(id),
  issue_kind  text        NOT NULL,
  scope       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  severity    text        NOT NULL DEFAULT 'medium'
                          CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description text        NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  status      text        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'acknowledged', 'resolved', 'wont_fix')),
  resolved_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX substrate_known_issue_tenant_idx ON substrate_known_issue (tenant_id);
CREATE INDEX substrate_known_issue_open_idx
  ON substrate_known_issue (tenant_id, status) WHERE status IN ('open', 'acknowledged');

ALTER TABLE substrate_known_issue ENABLE ROW LEVEL SECURITY;

CREATE POLICY ski_tenant_isolation_select ON substrate_known_issue
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ski_tenant_isolation_insert ON substrate_known_issue
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ski_tenant_isolation_update ON substrate_known_issue
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
