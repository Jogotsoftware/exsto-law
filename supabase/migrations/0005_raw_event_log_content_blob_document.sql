-- =============================================================================
-- Migration 0005: Ingestion + document substrate
-- raw_event_log captures inbound payloads from integrations (Granola, Google
-- Calendar, etc.) before projection. content_blob stores opaque content;
-- document_version is a versioned, attribute-rich pointer at content_blob
-- rows for entities of kind 'draft_document' or 'engagement_letter'.
-- =============================================================================

CREATE TABLE raw_event_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id),
  source_type   text        NOT NULL
                            CHECK (source_type IN ('integration', 'agent', 'system')),
  source_ref    text        NOT NULL,
  external_id   text,
  payload       jsonb       NOT NULL,
  content_hash  bytea       NOT NULL,
  previous_hash bytea,
  received_at   timestamptz NOT NULL DEFAULT now(),
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX raw_event_log_tenant_idx ON raw_event_log (tenant_id);
CREATE INDEX raw_event_log_source_idx ON raw_event_log (tenant_id, source_type, source_ref);
CREATE INDEX raw_event_log_received_idx ON raw_event_log (tenant_id, received_at DESC);

ALTER TABLE raw_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY rel_tenant_isolation_select ON raw_event_log
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY rel_tenant_isolation_insert ON raw_event_log
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Append-only (ADR 0014).
CREATE POLICY rel_no_update ON raw_event_log FOR UPDATE USING (false);
CREATE POLICY rel_no_delete ON raw_event_log FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- content_blob
-- Opaque content store. References from document_version, attachments,
-- transcript bodies, anything large enough not to live in a jsonb column.
-- -----------------------------------------------------------------------------

CREATE TABLE content_blob (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id),
  action_id     uuid        NOT NULL REFERENCES action(id),
  content_type  text        NOT NULL,
  body          text        NOT NULL,
  sha256        bytea       NOT NULL,
  size_bytes    integer     NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_blob_tenant_idx ON content_blob (tenant_id);
CREATE INDEX content_blob_sha_idx ON content_blob (tenant_id, sha256);

ALTER TABLE content_blob ENABLE ROW LEVEL SECURITY;

CREATE POLICY cb_tenant_isolation_select ON content_blob
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY cb_tenant_isolation_insert ON content_blob
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- document_version
-- Each row is one immutable version of a document entity. The document itself
-- is an entity (entity_kind = 'draft_document' or 'engagement_letter'). Newer
-- versions are appended; old versions are not deleted.
-- -----------------------------------------------------------------------------

CREATE TABLE document_version (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  document_entity_id  uuid        NOT NULL REFERENCES entity(id),
  content_blob_id     uuid        NOT NULL REFERENCES content_blob(id),
  version_number      integer     NOT NULL,
  status              text        NOT NULL
                                  CHECK (status IN (
                                    'pending_review', 'approved', 'revision_requested',
                                    'rejected', 'superseded'
                                  )),
  reasoning_trace_id  uuid        REFERENCES reasoning_trace(id),
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX document_version_unique
  ON document_version (tenant_id, document_entity_id, version_number);

CREATE INDEX document_version_pending_idx
  ON document_version (tenant_id, status)
  WHERE status = 'pending_review';

ALTER TABLE document_version ENABLE ROW LEVEL SECURITY;

CREATE POLICY dv_tenant_isolation_select ON document_version
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY dv_tenant_isolation_insert ON document_version
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY dv_tenant_isolation_update ON document_version
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
