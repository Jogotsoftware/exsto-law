-- =============================================================================
-- Migration 0012: Enrich the core definition registries
-- The 0002 registries were minimal (name/display/description/metadata). The
-- architecture describes richer schemas: entity-kind inheritance + capability
-- flags, attribute typing / PII / computed specs scoped to an entity kind, and
-- relationship cardinality / directionality / inverse. All additions are
-- nullable or defaulted, so existing rows remain valid (invariant 23).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- entity_kind_definition: inheritance + capability flags
-- -----------------------------------------------------------------------------

ALTER TABLE entity_kind_definition
  ADD COLUMN parent_kind_id          uuid REFERENCES entity_kind_definition(id),
  ADD COLUMN supports_temporal_state boolean NOT NULL DEFAULT true,
  ADD COLUMN supports_judgment       boolean NOT NULL DEFAULT false,
  ADD COLUMN supports_outcomes       boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_period         boolean NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- attribute_kind_definition: typing, scope, validation, PII, computed spec
-- -----------------------------------------------------------------------------

ALTER TABLE attribute_kind_definition
  ADD COLUMN on_entity_kind_id uuid REFERENCES entity_kind_definition(id),
  ADD COLUMN value_type        text NOT NULL DEFAULT 'text'
                               CHECK (value_type IN (
                                 'text', 'number', 'boolean', 'date', 'datetime',
                                 'enum', 'reference', 'json', 'money', 'computed')),
  ADD COLUMN validation        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN is_required       boolean NOT NULL DEFAULT false,
  ADD COLUMN is_indexed        boolean NOT NULL DEFAULT false,
  ADD COLUMN is_pii            boolean NOT NULL DEFAULT false,
  ADD COLUMN is_computed       boolean NOT NULL DEFAULT false,
  ADD COLUMN computation_spec  jsonb;

CREATE INDEX attribute_kind_definition_on_entity_idx
  ON attribute_kind_definition (tenant_id, on_entity_kind_id);

-- -----------------------------------------------------------------------------
-- relationship_kind_definition: endpoints, cardinality, directionality, inverse
-- -----------------------------------------------------------------------------

ALTER TABLE relationship_kind_definition
  ADD COLUMN source_entity_kind_id uuid REFERENCES entity_kind_definition(id),
  ADD COLUMN target_entity_kind_id uuid REFERENCES entity_kind_definition(id),
  ADD COLUMN cardinality           text NOT NULL DEFAULT 'many_to_many'
                                    CHECK (cardinality IN ('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many')),
  ADD COLUMN directionality        text NOT NULL DEFAULT 'directed'
                                    CHECK (directionality IN ('directed', 'undirected')),
  ADD COLUMN inverse_kind_name     text;
