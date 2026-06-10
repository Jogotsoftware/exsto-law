-- =============================================================================
-- Migration 0002: Core definition registries
-- Adds schema-as-data registries for the core substrate primitives.
-- =============================================================================

CREATE TABLE entity_kind_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind_name text NOT NULL,
  display_name text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entity_kind_definition_tenant_idx
  ON entity_kind_definition (tenant_id);

CREATE INDEX entity_kind_definition_lookup_idx
  ON entity_kind_definition (tenant_id, kind_name, valid_from DESC);

ALTER TABLE entity_kind_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY ekd_tenant_isolation_select ON entity_kind_definition
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ekd_tenant_isolation_insert ON entity_kind_definition
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ekd_tenant_isolation_update ON entity_kind_definition
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE attribute_kind_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind_name text NOT NULL,
  display_name text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX akd_tenant_idx
  ON attribute_kind_definition (tenant_id);

CREATE INDEX akd_lookup_idx
  ON attribute_kind_definition (tenant_id, kind_name, valid_from DESC);

ALTER TABLE attribute_kind_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY akd_tenant_isolation_select ON attribute_kind_definition
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY akd_tenant_isolation_insert ON attribute_kind_definition
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY akd_tenant_isolation_update ON attribute_kind_definition
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE relationship_kind_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind_name text NOT NULL,
  display_name text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rkd_tenant_idx
  ON relationship_kind_definition (tenant_id);

CREATE INDEX rkd_lookup_idx
  ON relationship_kind_definition (tenant_id, kind_name, valid_from DESC);

ALTER TABLE relationship_kind_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY rkd_tenant_isolation_select ON relationship_kind_definition
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY rkd_tenant_isolation_insert ON relationship_kind_definition
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY rkd_tenant_isolation_update ON relationship_kind_definition
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
