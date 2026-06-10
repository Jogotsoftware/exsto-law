-- =============================================================================
-- Migration 0011: Reasoning/verification + remaining action primitives
-- causal_claim, fact_contestation, access_log, purpose_definition,
-- actor_scope_assignment, subscription.
-- reasoning_trace already exists (migration 0004). Completes the Layer 2 set.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- causal_claim  (asserted causal links; the structured causality graph,
-- invariant 19). Append-only per CLAUDE.md hard rule 3.
-- -----------------------------------------------------------------------------

CREATE TABLE causal_claim (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id),
  action_id         uuid        NOT NULL REFERENCES action(id),
  cause_kind        text        NOT NULL
                                CHECK (cause_kind IN ('event', 'action', 'judgment', 'outcome')),
  cause_id          uuid        NOT NULL,
  effect_kind       text        NOT NULL
                                CHECK (effect_kind IN ('event', 'action', 'judgment', 'outcome')),
  effect_id         uuid        NOT NULL,
  claim_kind        text        NOT NULL
                                CHECK (claim_kind IN ('necessary', 'sufficient', 'contributing', 'preventing', 'enabling')),
  asserter_actor_id uuid        NOT NULL REFERENCES actor(id),
  confidence        numeric     NOT NULL
                                CHECK (confidence >= 0 AND confidence <= 1),
  reasoning         text,
  evidence          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  source_type       text        NOT NULL
                                CHECK (source_type IN ('human', 'integration', 'agent', 'system')),
  source_ref        text,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX causal_claim_tenant_idx ON causal_claim (tenant_id);
CREATE INDEX causal_claim_cause_idx ON causal_claim (tenant_id, cause_kind, cause_id);
CREATE INDEX causal_claim_effect_idx ON causal_claim (tenant_id, effect_kind, effect_id);

ALTER TABLE causal_claim ENABLE ROW LEVEL SECURITY;

CREATE POLICY cac_tenant_isolation_select ON causal_claim
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cac_tenant_isolation_insert ON causal_claim
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cac_no_update ON causal_claim FOR UPDATE USING (false);
CREATE POLICY cac_no_delete ON causal_claim FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- fact_contestation  (conflicts between facts as first-class observations,
-- invariant 21). Append-only per CLAUDE.md hard rule 3: status transitions are
-- new rows referencing the prior via supersedes_id (contestation_group_id
-- groups the chain; current state is the chain head).
-- -----------------------------------------------------------------------------

CREATE TABLE fact_contestation (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  contestation_group_id uuid      NOT NULL,
  supersedes_id       uuid        REFERENCES fact_contestation(id),
  contested_fact_kind text        NOT NULL
                                  CHECK (contested_fact_kind IN ('attribute', 'relationship', 'judgment', 'outcome', 'event')),
  contested_fact_id   uuid        NOT NULL,
  conflicting_fact_id uuid,
  contestation_kind   text        NOT NULL
                                  CHECK (contestation_kind IN ('value', 'temporal', 'identity')),
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'acknowledged', 'adjudicated', 'resolved')),
  detected_by         text        NOT NULL DEFAULT 'system'
                                  CHECK (detected_by IN ('system', 'human', 'agent')),
  resolution          jsonb,
  resolved_by_actor_id uuid       REFERENCES actor(id),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fact_contestation_tenant_idx ON fact_contestation (tenant_id);
CREATE INDEX fact_contestation_group_idx
  ON fact_contestation (tenant_id, contestation_group_id, recorded_at DESC);
CREATE INDEX fact_contestation_fact_idx
  ON fact_contestation (tenant_id, contested_fact_kind, contested_fact_id);

ALTER TABLE fact_contestation ENABLE ROW LEVEL SECURITY;

CREATE POLICY fc_tenant_isolation_select ON fact_contestation
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY fc_tenant_isolation_insert ON fact_contestation
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY fc_no_update ON fact_contestation FOR UPDATE USING (false);
CREATE POLICY fc_no_delete ON fact_contestation FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- access_log  (read-side audit; voluminous). Append-only per CLAUDE.md hard
-- rule 3. Records who accessed what, with what authorization, for what purpose.
-- -----------------------------------------------------------------------------

CREATE TABLE access_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id),
  actor_id        uuid        NOT NULL REFERENCES actor(id),
  accessed_kind   text        NOT NULL,
  accessed_id     uuid,
  query_summary   text,
  authorization_scope text,
  purpose_ref     text,
  accessed_at     timestamptz NOT NULL DEFAULT now(),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_log_tenant_idx ON access_log (tenant_id);
CREATE INDEX access_log_actor_idx ON access_log (tenant_id, actor_id, accessed_at DESC);
CREATE INDEX access_log_target_idx ON access_log (tenant_id, accessed_kind, accessed_id);

ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY al_tenant_isolation_select ON access_log
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY al_tenant_isolation_insert ON access_log
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY al_no_update ON access_log FOR UPDATE USING (false);
CREATE POLICY al_no_delete ON access_log FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- purpose_definition  (declared purposes for data access; schema present,
-- enforcement deferred per DoD). Configuration data.
-- -----------------------------------------------------------------------------

CREATE TABLE purpose_definition (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenant(id),
  action_id     uuid        NOT NULL REFERENCES action(id),
  purpose_name  text        NOT NULL,
  display_name  text        NOT NULL,
  description   text,
  config        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'deprecated')),
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX purpose_definition_tenant_idx ON purpose_definition (tenant_id);
CREATE INDEX purpose_definition_lookup_idx
  ON purpose_definition (tenant_id, purpose_name, valid_from DESC);

ALTER TABLE purpose_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY purd_tenant_isolation_select ON purpose_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY purd_tenant_isolation_insert ON purpose_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY purd_tenant_isolation_update ON purpose_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- actor_scope_assignment  (assigns a permission scope to an actor; temporal)
-- Governance gradients (invariant 22): an actor's authorization is the union of
-- its active scope assignments.
-- -----------------------------------------------------------------------------

CREATE TABLE actor_scope_assignment (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL REFERENCES tenant(id),
  action_id                   uuid        NOT NULL REFERENCES action(id),
  actor_id                    uuid        NOT NULL REFERENCES actor(id),
  permission_scope_definition_id uuid     NOT NULL REFERENCES permission_scope_definition(id),
  valid_from                  timestamptz NOT NULL DEFAULT now(),
  valid_to                    timestamptz,
  recorded_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX actor_scope_assignment_tenant_idx ON actor_scope_assignment (tenant_id);
CREATE INDEX actor_scope_assignment_actor_idx
  ON actor_scope_assignment (tenant_id, actor_id, valid_from DESC);

ALTER TABLE actor_scope_assignment ENABLE ROW LEVEL SECURITY;

CREATE POLICY asa_tenant_isolation_select ON actor_scope_assignment
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY asa_tenant_isolation_insert ON actor_scope_assignment
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY asa_tenant_isolation_update ON actor_scope_assignment
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- subscription  (an actor's interest in events affecting entities). Distinct
-- from notification routing (rule-based) and access logs (post-hoc).
-- -----------------------------------------------------------------------------

CREATE TABLE subscription (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id),
  action_id       uuid        NOT NULL REFERENCES action(id),
  subscriber_actor_id uuid    NOT NULL REFERENCES actor(id),
  event_kind_id   uuid        REFERENCES event_kind_definition(id),
  entity_id       uuid        REFERENCES entity(id),
  filter_expression jsonb     NOT NULL DEFAULT '{}'::jsonb,
  channel         text        NOT NULL DEFAULT 'in_app'
                              CHECK (channel IN ('email', 'slack', 'sms', 'in_app', 'webhook')),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'paused', 'cancelled')),
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_tenant_idx ON subscription (tenant_id);
CREATE INDEX subscription_subscriber_idx ON subscription (tenant_id, subscriber_actor_id);
CREATE INDEX subscription_entity_idx ON subscription (tenant_id, entity_id) WHERE entity_id IS NOT NULL;

ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;

CREATE POLICY sub_tenant_isolation_select ON subscription
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sub_tenant_isolation_insert ON subscription
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sub_tenant_isolation_update ON subscription
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
