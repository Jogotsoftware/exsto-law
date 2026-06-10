-- =============================================================================
-- Migration 0004: Reasoning trace
-- Adds reasoning trace capture (ADR 0020). Matter is modeled as an entity in
-- the entity primitive (entity_kind = 'matter'); there is no parallel
-- legal_matter table — that would bypass the entity layer and break the
-- "unified operational and judgmental data" commitment.
-- =============================================================================

CREATE TABLE reasoning_trace (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id),
  agent_actor_id  uuid        NOT NULL REFERENCES actor(id),
  prompt          text        NOT NULL,
  evidence        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  alternatives    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  conclusion      text        NOT NULL,
  confidence      numeric     NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  model_identity  text,
  trace           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reasoning_trace_tenant_idx ON reasoning_trace (tenant_id);
CREATE INDEX reasoning_trace_agent_idx ON reasoning_trace (tenant_id, agent_actor_id);

ALTER TABLE reasoning_trace ENABLE ROW LEVEL SECURITY;

CREATE POLICY reasoning_trace_tenant_isolation_select ON reasoning_trace
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY reasoning_trace_tenant_isolation_insert ON reasoning_trace
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Reasoning traces are append-only at the application layer (ADR 0020); no
-- UPDATE/DELETE policies, mirroring the action log pattern from migration 0001.

-- Now that the table exists, wire up the deferred FK from action.reasoning_trace_id.
ALTER TABLE action
  ADD CONSTRAINT action_reasoning_trace_fk
  FOREIGN KEY (reasoning_trace_id) REFERENCES reasoning_trace(id);
