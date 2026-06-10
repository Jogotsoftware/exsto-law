-- =============================================================================
-- Migration 0007: Identity and ingestion primitives
-- identity_assertion, source_record_link, integration_mapping,
-- authoritative_source_designation, conflict_resolution_rule.
-- raw_event_log already exists (migration 0005). These primitives implement
-- stable identity (invariant 4) and deterministic cross-system reconciliation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- identity_assertion
-- A fact that two entities are the same / different / related. Identity is
-- managed through non-destructive assertions (invariant 4), never destructive
-- merges. Append-only (invariant 14): supersession is a new row pointing at the
-- one it replaces via supersedes_id; the current view is derived.
-- -----------------------------------------------------------------------------

CREATE TABLE identity_assertion (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id),
  action_id       uuid        NOT NULL REFERENCES action(id),
  assertion_kind  text        NOT NULL
                              CHECK (assertion_kind IN ('same_as', 'different_from', 'related_to')),
  entity_a_id     uuid        NOT NULL REFERENCES entity(id),
  entity_b_id     uuid        NOT NULL REFERENCES entity(id),
  confidence      numeric     NOT NULL
                              CHECK (confidence >= 0 AND confidence <= 1),
  evidence        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  asserter_actor_id uuid      NOT NULL REFERENCES actor(id),
  source_type     text        NOT NULL
                              CHECK (source_type IN ('human', 'integration', 'agent', 'system')),
  source_ref      text,
  supersedes_id   uuid        REFERENCES identity_assertion(id),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_assertion_tenant_idx ON identity_assertion (tenant_id);
CREATE INDEX identity_assertion_a_idx ON identity_assertion (tenant_id, entity_a_id);
CREATE INDEX identity_assertion_b_idx ON identity_assertion (tenant_id, entity_b_id);

ALTER TABLE identity_assertion ENABLE ROW LEVEL SECURITY;

CREATE POLICY ia_tenant_isolation_select ON identity_assertion
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ia_tenant_isolation_insert ON identity_assertion
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ia_no_update ON identity_assertion FOR UPDATE USING (false);
CREATE POLICY ia_no_delete ON identity_assertion FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- source_record_link
-- Every external record's link to its canonical entity. Persists forever;
-- survives integration disconnection. Status is mutable (active ->
-- disconnected -> deleted_in_source), so UPDATE is permitted.
-- -----------------------------------------------------------------------------

CREATE TABLE source_record_link (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenant(id),
  action_id          uuid        NOT NULL REFERENCES action(id),
  entity_id          uuid        NOT NULL REFERENCES entity(id),
  source_system      text        NOT NULL,
  source_record_id   text        NOT NULL,
  status             text        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'disconnected', 'deleted_in_source')),
  is_identity_anchor boolean     NOT NULL DEFAULT false,
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from         timestamptz NOT NULL DEFAULT now(),
  recorded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX source_record_link_unique
  ON source_record_link (tenant_id, source_system, source_record_id);
CREATE INDEX source_record_link_entity_idx ON source_record_link (tenant_id, entity_id);

ALTER TABLE source_record_link ENABLE ROW LEVEL SECURITY;

CREATE POLICY srl_tenant_isolation_select ON source_record_link
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY srl_tenant_isolation_insert ON source_record_link
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY srl_tenant_isolation_update ON source_record_link
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- integration_mapping
-- Versioned, time-bounded rules translating a source field to a canonical kind
-- (invariant 23: configuration, not code). Flags identity / relationship
-- anchors and PII. transformation holds the constrained DSL.
-- -----------------------------------------------------------------------------

CREATE TABLE integration_mapping (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenant(id),
  action_id             uuid        NOT NULL REFERENCES action(id),
  source_system         text        NOT NULL,
  source_field          text        NOT NULL,
  target_kind           text        NOT NULL
                                    CHECK (target_kind IN ('entity_kind', 'attribute_kind', 'relationship_kind')),
  target_kind_name      text        NOT NULL,
  transformation        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_identity_anchor    boolean     NOT NULL DEFAULT false,
  is_relationship_anchor boolean    NOT NULL DEFAULT false,
  contains_pii          boolean     NOT NULL DEFAULT false,
  version               integer     NOT NULL DEFAULT 1,
  valid_from            timestamptz NOT NULL DEFAULT now(),
  valid_to              timestamptz,
  status                text        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'deprecated')),
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_mapping_tenant_idx ON integration_mapping (tenant_id);
CREATE INDEX integration_mapping_lookup_idx
  ON integration_mapping (tenant_id, source_system, source_field, valid_from DESC);

ALTER TABLE integration_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY im_tenant_isolation_select ON integration_mapping
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY im_tenant_isolation_insert ON integration_mapping
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY im_tenant_isolation_update ON integration_mapping
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- authoritative_source_designation
-- For an attribute kind (optionally filtered), declares which source system is
-- canonical. Resolves cross-system conflicts deterministically.
-- -----------------------------------------------------------------------------

CREATE TABLE authoritative_source_designation (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  attribute_kind_id   uuid        NOT NULL REFERENCES attribute_kind_definition(id),
  source_system       text        NOT NULL,
  filter_expression   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  priority            integer     NOT NULL DEFAULT 0,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'deprecated')),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asd_tenant_idx ON authoritative_source_designation (tenant_id);
CREATE INDEX asd_attr_idx ON authoritative_source_designation (tenant_id, attribute_kind_id, valid_from DESC);

ALTER TABLE authoritative_source_designation ENABLE ROW LEVEL SECURITY;

CREATE POLICY asd_tenant_isolation_select ON authoritative_source_designation
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY asd_tenant_isolation_insert ON authoritative_source_designation
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY asd_tenant_isolation_update ON authoritative_source_designation
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- conflict_resolution_rule
-- Per attribute kind, how to handle write conflicts. Configuration, not code.
-- -----------------------------------------------------------------------------

CREATE TABLE conflict_resolution_rule (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenant(id),
  action_id             uuid        NOT NULL REFERENCES action(id),
  attribute_kind_id     uuid        NOT NULL REFERENCES attribute_kind_definition(id),
  strategy              text        NOT NULL DEFAULT 'highest_confidence'
                                    CHECK (strategy IN ('source_priority', 'latest_wins', 'highest_confidence', 'manual_review')),
  source_priority       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  human_override_window_seconds integer,
  config                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from            timestamptz NOT NULL DEFAULT now(),
  valid_to              timestamptz,
  status                text        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'deprecated')),
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crr_tenant_idx ON conflict_resolution_rule (tenant_id);
CREATE INDEX crr_attr_idx ON conflict_resolution_rule (tenant_id, attribute_kind_id, valid_from DESC);

ALTER TABLE conflict_resolution_rule ENABLE ROW LEVEL SECURITY;

CREATE POLICY crr_tenant_isolation_select ON conflict_resolution_rule
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY crr_tenant_isolation_insert ON conflict_resolution_rule
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY crr_tenant_isolation_update ON conflict_resolution_rule
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
