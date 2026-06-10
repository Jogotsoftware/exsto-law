-- =============================================================================
-- Migration 0015: Semantic search substrate (pgvector)
-- Enables vector embeddings over any substrate object (content blobs, entities,
-- messages) for AI semantic retrieval. Embedding generation is pluggable (an
-- adapter calls an embedding model and inserts rows); this migration provides
-- the storage + similarity index. Dimension defaults to 1536 (adjust to match
-- the chosen embedding model, e.g. 1024 for Voyage).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE content_embedding (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenant(id),
  subject_kind text        NOT NULL,          -- 'content_blob' | 'entity' | 'communication_message' | ...
  subject_id   uuid        NOT NULL,
  model        text        NOT NULL,          -- embedding model identity (provenance)
  embedding    vector(1536) NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_embedding_tenant_idx ON content_embedding (tenant_id);
CREATE INDEX content_embedding_subject_idx ON content_embedding (tenant_id, subject_kind, subject_id);
-- Cosine-distance ANN index for similarity search.
CREATE INDEX content_embedding_hnsw_idx ON content_embedding
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE content_embedding ENABLE ROW LEVEL SECURITY;

CREATE POLICY ce_tenant_isolation_select ON content_embedding
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ce_tenant_isolation_insert ON content_embedding
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ce_tenant_isolation_update ON content_embedding
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
