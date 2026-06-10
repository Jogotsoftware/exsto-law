-- =============================================================================
-- Migration 0003: Core primitive tables
-- entity, attribute, relationship — with provenance (invariant 5),
-- knowability (invariant 7) and time precision (invariant 3) per the ADRs.
-- =============================================================================

CREATE TABLE entity (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id),
  action_id       uuid        NOT NULL REFERENCES action(id),
  entity_kind_id  uuid        NOT NULL REFERENCES entity_kind_definition(id),
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'archived', 'suspended')),
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entity_tenant_idx ON entity (tenant_id);
CREATE INDEX entity_kind_idx ON entity (tenant_id, entity_kind_id);
CREATE INDEX entity_action_idx ON entity (tenant_id, action_id);

ALTER TABLE entity ENABLE ROW LEVEL SECURITY;

CREATE POLICY entity_tenant_isolation_select ON entity
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY entity_tenant_isolation_insert ON entity
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY entity_tenant_isolation_update ON entity
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- attribute
-- Carries knowability (ADR 0007), time precision (ADR 0003), provenance
-- (ADR 0005), and validity range (temporality, ADR 0002). Attribute rows are
-- append-only at the application layer: new observations supersede old ones
-- by valid_from ordering; we do not UPDATE prior rows.
-- -----------------------------------------------------------------------------

CREATE TABLE attribute (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenant(id),
  action_id          uuid        NOT NULL REFERENCES action(id),
  entity_id          uuid        NOT NULL REFERENCES entity(id),
  attribute_kind_id  uuid        NOT NULL REFERENCES attribute_kind_definition(id),
  value              jsonb       NOT NULL,
  confidence         numeric     NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  knowability_state  text        NOT NULL DEFAULT 'observed'
                                 CHECK (knowability_state IN (
                                   'observed', 'observed_null', 'never_observed',
                                   'withheld', 'inapplicable', 'pending',
                                   'stale', 'computation_failed'
                                 )),
  time_precision     text        NOT NULL DEFAULT 'exact_instant'
                                 CHECK (time_precision IN (
                                   'exact_instant', 'second', 'minute', 'hour',
                                   'day', 'week', 'month', 'quarter', 'year',
                                   'range', 'approximate', 'unknown'
                                 )),
  source_type        text        NOT NULL
                                 CHECK (source_type IN ('human', 'integration', 'agent', 'system')),
  source_ref         text,
  polarity           text        NOT NULL DEFAULT 'positive'
                                 CHECK (polarity IN ('positive', 'negative')),
  valid_from         timestamptz NOT NULL DEFAULT now(),
  valid_to           timestamptz,
  recorded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attribute_tenant_idx ON attribute (tenant_id);
CREATE INDEX attribute_entity_idx ON attribute (tenant_id, entity_id);
CREATE INDEX attribute_kind_idx ON attribute (tenant_id, attribute_kind_id);
CREATE INDEX attribute_current_idx
  ON attribute (tenant_id, entity_id, attribute_kind_id, valid_from DESC);

ALTER TABLE attribute ENABLE ROW LEVEL SECURITY;

CREATE POLICY attribute_tenant_isolation_select ON attribute
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY attribute_tenant_isolation_insert ON attribute
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY attribute_tenant_isolation_update ON attribute
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- relationship
-- -----------------------------------------------------------------------------

CREATE TABLE relationship (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenant(id),
  action_id             uuid        NOT NULL REFERENCES action(id),
  source_entity_id      uuid        NOT NULL REFERENCES entity(id),
  target_entity_id      uuid        NOT NULL REFERENCES entity(id),
  relationship_kind_id  uuid        NOT NULL REFERENCES relationship_kind_definition(id),
  properties            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from            timestamptz NOT NULL DEFAULT now(),
  valid_to              timestamptz,
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX relationship_tenant_idx ON relationship (tenant_id);
CREATE INDEX relationship_source_idx
  ON relationship (tenant_id, source_entity_id, relationship_kind_id);
CREATE INDEX relationship_target_idx
  ON relationship (tenant_id, target_entity_id, relationship_kind_id);

ALTER TABLE relationship ENABLE ROW LEVEL SECURITY;

CREATE POLICY relationship_tenant_isolation_select ON relationship
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY relationship_tenant_isolation_insert ON relationship
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY relationship_tenant_isolation_update ON relationship
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
