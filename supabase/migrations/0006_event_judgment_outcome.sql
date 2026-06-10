-- =============================================================================
-- Migration 0006: Completing the seven core primitives
-- Adds event, judgment, outcome and their definition registries. Together with
-- entity (0003), attribute (0003), relationship (0003) and action (0001) this
-- completes the seven core Layer 2 primitives of ARCHITECTURE.md v2.0.
--
-- HLC / hash-chain convention (consistent with 0001 action, 0005 raw_event_log):
--   append-only LOG tables (event) carry their own hybrid logical clock
--   (invariant 15) and hash chain (invariant 18). FACT/state tables (judgment,
--   outcome) inherit causal ordering from the action that wrote them
--   (action_id -> action.hlc_*) and use valid_from/valid_to for supersession,
--   mirroring the attribute and relationship tables in 0003.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- event_kind_definition  (schema-as-data, invariant 12)
-- -----------------------------------------------------------------------------

CREATE TABLE event_kind_definition (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id),
  kind_name       text        NOT NULL,
  display_name    text        NOT NULL,
  description     text,
  is_state_change boolean     NOT NULL DEFAULT false,  -- state change vs pure observation
  immutability_tier text      NOT NULL DEFAULT 'standard'
                              CHECK (immutability_tier IN ('standard', 'high_stakes')),
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- payload schema, entity expectations
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'deprecated')),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_kind_definition_tenant_idx ON event_kind_definition (tenant_id);
CREATE INDEX event_kind_definition_lookup_idx
  ON event_kind_definition (tenant_id, kind_name, valid_from DESC);

ALTER TABLE event_kind_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY ekdf_tenant_isolation_select ON event_kind_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ekdf_tenant_isolation_insert ON event_kind_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ekdf_tenant_isolation_update ON event_kind_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- event
-- Something that happened. Append-only (invariant 14): no UPDATE/DELETE.
-- Carries its own HLC (invariant 15), provenance (invariant 5), time precision
-- on occurred_at (invariant 3), confidence (invariant 6) and a hash chain
-- (invariant 18, off by default / per-tenant).
-- -----------------------------------------------------------------------------

CREATE TABLE event (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenant(id),
  action_id            uuid        NOT NULL REFERENCES action(id),
  event_kind_id        uuid        NOT NULL REFERENCES event_kind_definition(id),
  primary_entity_id    uuid        REFERENCES entity(id),
  secondary_entity_ids uuid[]      NOT NULL DEFAULT '{}',
  payload              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  confidence           numeric     NOT NULL DEFAULT 1.0
                                   CHECK (confidence >= 0 AND confidence <= 1),
  source_type          text        NOT NULL
                                   CHECK (source_type IN ('human', 'integration', 'agent', 'system')),
  source_ref           text,
  occurred_at          timestamptz NOT NULL,
  occurred_at_precision text       NOT NULL DEFAULT 'exact_instant'
                                   CHECK (occurred_at_precision IN (
                                     'exact_instant', 'second', 'minute', 'hour',
                                     'day', 'week', 'month', 'quarter', 'year',
                                     'range', 'approximate', 'unknown')),
  hlc_physical_time    timestamptz NOT NULL,
  hlc_logical_counter  integer     NOT NULL,
  hlc_source_id        uuid        NOT NULL,
  content_hash         bytea,
  previous_hash        bytea,
  recorded_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_tenant_idx ON event (tenant_id);
CREATE INDEX event_kind_idx ON event (tenant_id, event_kind_id);
CREATE INDEX event_primary_entity_idx
  ON event (tenant_id, primary_entity_id) WHERE primary_entity_id IS NOT NULL;
CREATE INDEX event_occurred_idx ON event (tenant_id, occurred_at DESC);
CREATE INDEX event_action_idx ON event (tenant_id, action_id);

ALTER TABLE event ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_tenant_isolation_select ON event
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY event_tenant_isolation_insert ON event
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Append-only (invariant 14).
CREATE POLICY event_no_update ON event FOR UPDATE USING (false);
CREATE POLICY event_no_delete ON event FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- judgment_kind_definition
-- -----------------------------------------------------------------------------

CREATE TABLE judgment_kind_definition (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  kind_name           text        NOT NULL,
  display_name        text        NOT NULL,
  description         text,
  about_entity_kind_id uuid       REFERENCES entity_kind_definition(id),
  value_type          text        NOT NULL DEFAULT 'structured'
                                  CHECK (value_type IN ('rating', 'enum', 'text', 'structured')),
  decay_function      text        NOT NULL DEFAULT 'none'
                                  CHECK (decay_function IN ('none', 'linear', 'exponential', 'step')),
  half_life_days      numeric,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'deprecated')),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX judgment_kind_definition_tenant_idx ON judgment_kind_definition (tenant_id);
CREATE INDEX judgment_kind_definition_lookup_idx
  ON judgment_kind_definition (tenant_id, kind_name, valid_from DESC);

ALTER TABLE judgment_kind_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY jkd_tenant_isolation_select ON judgment_kind_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY jkd_tenant_isolation_insert ON judgment_kind_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY jkd_tenant_isolation_update ON judgment_kind_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- judgment
-- Human or agent qualitative assessment about an entity. Temporal and
-- superseded (valid_to closes prior rows), never overwritten in app code.
-- Carries confidence (6), provenance (5), reasoning capture link (20).
-- -----------------------------------------------------------------------------

CREATE TABLE judgment (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  judgment_kind_id    uuid        NOT NULL REFERENCES judgment_kind_definition(id),
  subject_entity_id   uuid        NOT NULL REFERENCES entity(id),
  judging_actor_id    uuid        NOT NULL REFERENCES actor(id),
  value               jsonb       NOT NULL,
  confidence          numeric     NOT NULL
                                  CHECK (confidence >= 0 AND confidence <= 1),
  evidence            jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- event/fact references
  reasoning           text,
  reasoning_trace_id  uuid        REFERENCES reasoning_trace(id),
  source_type         text        NOT NULL
                                  CHECK (source_type IN ('human', 'integration', 'agent', 'system')),
  source_ref          text,
  polarity            text        NOT NULL DEFAULT 'positive'
                                  CHECK (polarity IN ('positive', 'negative')),
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX judgment_tenant_idx ON judgment (tenant_id);
CREATE INDEX judgment_subject_idx ON judgment (tenant_id, subject_entity_id);
CREATE INDEX judgment_kind_idx ON judgment (tenant_id, judgment_kind_id);
CREATE INDEX judgment_current_idx
  ON judgment (tenant_id, subject_entity_id, judgment_kind_id, valid_from DESC);

ALTER TABLE judgment ENABLE ROW LEVEL SECURITY;

CREATE POLICY judgment_tenant_isolation_select ON judgment
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY judgment_tenant_isolation_insert ON judgment
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY judgment_tenant_isolation_update ON judgment
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- outcome_kind_definition
-- -----------------------------------------------------------------------------

CREATE TABLE outcome_kind_definition (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  kind_name           text        NOT NULL,
  display_name        text        NOT NULL,
  description         text,
  about_entity_kind_id uuid       REFERENCES entity_kind_definition(id),
  polarity            text        NOT NULL DEFAULT 'neutral'
                                  CHECK (polarity IN ('positive', 'negative', 'neutral')),
  is_terminal         boolean     NOT NULL DEFAULT false,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- required outcome_data fields
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'deprecated')),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outcome_kind_definition_tenant_idx ON outcome_kind_definition (tenant_id);
CREATE INDEX outcome_kind_definition_lookup_idx
  ON outcome_kind_definition (tenant_id, kind_name, valid_from DESC);

ALTER TABLE outcome_kind_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY okd_tenant_isolation_select ON outcome_kind_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY okd_tenant_isolation_insert ON outcome_kind_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY okd_tenant_isolation_update ON outcome_kind_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- outcome
-- A realized result for an entity. The validation signal that makes the
-- substrate valuable for AI (ADR 0028). Causal links to predicting events and
-- judgments are first-class rows in causal_claim (migration 0012); evidence
-- references are kept inline for convenience.
-- -----------------------------------------------------------------------------

CREATE TABLE outcome (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  outcome_kind_id     uuid        NOT NULL REFERENCES outcome_kind_definition(id),
  subject_entity_id   uuid        NOT NULL REFERENCES entity(id),
  outcome_data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  polarity            text        NOT NULL DEFAULT 'neutral'
                                  CHECK (polarity IN ('positive', 'negative', 'neutral')),
  confidence          numeric     NOT NULL DEFAULT 1.0
                                  CHECK (confidence >= 0 AND confidence <= 1),
  evidence            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  source_type         text        NOT NULL
                                  CHECK (source_type IN ('human', 'integration', 'agent', 'system')),
  source_ref          text,
  occurred_at         timestamptz NOT NULL,
  occurred_at_precision text      NOT NULL DEFAULT 'exact_instant'
                                  CHECK (occurred_at_precision IN (
                                    'exact_instant', 'second', 'minute', 'hour',
                                    'day', 'week', 'month', 'quarter', 'year',
                                    'range', 'approximate', 'unknown')),
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outcome_tenant_idx ON outcome (tenant_id);
CREATE INDEX outcome_subject_idx ON outcome (tenant_id, subject_entity_id);
CREATE INDEX outcome_kind_idx ON outcome (tenant_id, outcome_kind_id);
CREATE INDEX outcome_occurred_idx ON outcome (tenant_id, occurred_at DESC);

ALTER TABLE outcome ENABLE ROW LEVEL SECURITY;

CREATE POLICY outcome_tenant_isolation_select ON outcome
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY outcome_tenant_isolation_insert ON outcome
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY outcome_tenant_isolation_update ON outcome
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
