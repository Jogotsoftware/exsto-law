-- =============================================================================
-- Vertical migration 0103: module catalog + per-tenant enablement (ADR 0046 §5)
--
-- A "module" is a named FEATURE BUNDLE (billing, client-portal, e-sign, calendar,
-- documents, crm, matters) that the platform admin turns on/off per tenant. Two
-- tables, both config-as-data (invariant 12):
--   * module_definition  — the catalog. The MASTER catalog lives in the platform
--     tenant; the admin reads it in the platform context and (for enable) replays
--     a module's manifest into a target tenant. `ui_areas` gates the firm app nav;
--     `requires` declares the kinds/scopes a module installs (used by promotion).
--   * module_enablement   — per-tenant on/off + the manifest that was installed.
--     Written through the action layer (legal.module.enable/disable, 0104), so
--     every transition is an audited action; updated in place (lifecycle table).
--
-- Disable hides UI + deactivates the module's scopes but NEVER deletes kinds that
-- may hold data (data-safety, invariant 11/14).
--
-- Both tables carry tenant_id + RLS (invariant 1). Number 0103 = next after 0102.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-00FF-000000000001', false);

-- -----------------------------------------------------------------------------
-- module_definition — the catalog (master lives in the platform tenant).
-- Versioned like other *_definition tables; status active|deprecated.
-- -----------------------------------------------------------------------------
CREATE TABLE module_definition (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenant(id),
  module_key  text        NOT NULL,
  display_name text       NOT NULL,
  description text,
  ui_areas    jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["/attorney/billing"]
  requires    jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- install manifest (kinds/scopes/workflows)
  depends_on  jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- other module_keys
  version     integer     NOT NULL DEFAULT 1,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX module_definition_tenant_idx ON module_definition (tenant_id);
CREATE UNIQUE INDEX module_definition_active_key_idx
  ON module_definition (tenant_id, module_key) WHERE valid_to IS NULL;

ALTER TABLE module_definition ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON module_definition FROM anon;
CREATE POLICY md_select ON module_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY md_insert ON module_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY md_update ON module_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- module_enablement — per-tenant on/off state (one row per module per tenant).
-- -----------------------------------------------------------------------------
CREATE TABLE module_enablement (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenant(id),
  action_id          uuid        REFERENCES action(id),
  module_key         text        NOT NULL,
  enabled            boolean     NOT NULL DEFAULT false,
  installed_manifest jsonb       NOT NULL DEFAULT '{}'::jsonb,
  enabled_at         timestamptz,
  disabled_at        timestamptz,
  recorded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX module_enablement_tenant_idx ON module_enablement (tenant_id);
CREATE UNIQUE INDEX module_enablement_key_idx ON module_enablement (tenant_id, module_key);

ALTER TABLE module_enablement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON module_enablement FROM anon;
CREATE POLICY me_select ON module_enablement
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY me_insert ON module_enablement
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY me_update ON module_enablement
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

SELECT public.sync_migration_history();
