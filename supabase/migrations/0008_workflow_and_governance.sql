-- =============================================================================
-- Migration 0008: Workflow and governance primitives
-- workflow_definition, workflow_instance, trigger_definition,
-- notification_route_definition, permission_scope_definition, approval_request,
-- approval_response, policy_definition.
-- Implements governance gradients (invariant 22), configuration version
-- binding (invariant 17) and extensibility via configuration (invariant 23).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- workflow_definition  (a bounded state machine; versioned)
-- -----------------------------------------------------------------------------

CREATE TABLE workflow_definition (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  kind_name           text        NOT NULL,
  display_name        text        NOT NULL,
  description         text,
  states              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  transitions         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  participating_entity_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  version             integer     NOT NULL DEFAULT 1,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'deprecated')),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_definition_tenant_idx ON workflow_definition (tenant_id);
CREATE INDEX workflow_definition_lookup_idx
  ON workflow_definition (tenant_id, kind_name, version DESC);

ALTER TABLE workflow_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY wd_tenant_isolation_select ON workflow_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY wd_tenant_isolation_insert ON workflow_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY wd_tenant_isolation_update ON workflow_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- workflow_instance
-- A specific in-flight workflow. Bound to the workflow_definition VERSION row
-- it started with (invariant 17): rule changes do not race running processes.
-- -----------------------------------------------------------------------------

CREATE TABLE workflow_instance (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenant(id),
  action_id              uuid        NOT NULL REFERENCES action(id),
  workflow_definition_id uuid        NOT NULL REFERENCES workflow_definition(id),
  subject_entity_id      uuid        REFERENCES entity(id),
  current_state          text        NOT NULL,
  state_history          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status                 text        NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'completed', 'cancelled')),
  started_at             timestamptz NOT NULL DEFAULT now(),
  recorded_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_instance_tenant_idx ON workflow_instance (tenant_id);
CREATE INDEX workflow_instance_subject_idx ON workflow_instance (tenant_id, subject_entity_id);
CREATE INDEX workflow_instance_def_idx ON workflow_instance (tenant_id, workflow_definition_id);

ALTER TABLE workflow_instance ENABLE ROW LEVEL SECURITY;

CREATE POLICY wi_tenant_isolation_select ON workflow_instance
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY wi_tenant_isolation_insert ON workflow_instance
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY wi_tenant_isolation_update ON workflow_instance
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- trigger_definition  (event kind + filter -> action proposal; configuration)
-- -----------------------------------------------------------------------------

CREATE TABLE trigger_definition (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenant(id),
  action_id               uuid        NOT NULL REFERENCES action(id),
  kind_name               text        NOT NULL,
  display_name            text        NOT NULL,
  event_kind_id           uuid        NOT NULL REFERENCES event_kind_definition(id),
  filter_expression       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  proposed_action_kind_id uuid        NOT NULL REFERENCES action_kind_definition(id),
  autonomy_tier_override  text        CHECK (autonomy_tier_override IN ('autonomous', 'notify', 'approve', 'suggest')),
  version                 integer     NOT NULL DEFAULT 1,
  valid_from              timestamptz NOT NULL DEFAULT now(),
  valid_to                timestamptz,
  status                  text        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active', 'deprecated')),
  recorded_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trigger_definition_tenant_idx ON trigger_definition (tenant_id);
CREATE INDEX trigger_definition_event_idx ON trigger_definition (tenant_id, event_kind_id, valid_from DESC);

ALTER TABLE trigger_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY td_tenant_isolation_select ON trigger_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY td_tenant_isolation_insert ON trigger_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY td_tenant_isolation_update ON trigger_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- notification_route_definition  (declarative routing; configuration)
-- -----------------------------------------------------------------------------

CREATE TABLE notification_route_definition (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenant(id),
  action_id             uuid        NOT NULL REFERENCES action(id),
  kind_name             text        NOT NULL,
  display_name          text        NOT NULL,
  trigger_definition_id uuid        REFERENCES trigger_definition(id),
  channel               text        NOT NULL
                                    CHECK (channel IN ('email', 'slack', 'sms', 'in_app', 'webhook')),
  recipients            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  template_ref          text,
  config                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from            timestamptz NOT NULL DEFAULT now(),
  valid_to              timestamptz,
  status                text        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'deprecated')),
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nrd_tenant_idx ON notification_route_definition (tenant_id);

ALTER TABLE notification_route_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY nrd_tenant_isolation_select ON notification_route_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY nrd_tenant_isolation_insert ON notification_route_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY nrd_tenant_isolation_update ON notification_route_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- permission_scope_definition  (named permission collection; configuration)
-- Assigned to actors via actor_scope_assignment (migration 0011).
-- -----------------------------------------------------------------------------

CREATE TABLE permission_scope_definition (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenant(id),
  action_id             uuid        NOT NULL REFERENCES action(id),
  scope_name            text        NOT NULL,
  display_name          text        NOT NULL,
  description           text,
  action_kinds          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  entity_kinds          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  attribute_kinds       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  row_filter_expression jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from            timestamptz NOT NULL DEFAULT now(),
  valid_to              timestamptz,
  status                text        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'deprecated')),
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX psd_tenant_idx ON permission_scope_definition (tenant_id);
CREATE INDEX psd_lookup_idx ON permission_scope_definition (tenant_id, scope_name, valid_from DESC);

ALTER TABLE permission_scope_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY psd_tenant_isolation_select ON permission_scope_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY psd_tenant_isolation_insert ON permission_scope_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY psd_tenant_isolation_update ON permission_scope_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- approval_request  (multi-actor approval lifecycle; status mutable)
-- -----------------------------------------------------------------------------

CREATE TABLE approval_request (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  subject_action_id   uuid        REFERENCES action(id),
  subject_entity_id   uuid        REFERENCES entity(id),
  approval_logic      text        NOT NULL DEFAULT 'all'
                                  CHECK (approval_logic IN ('all', 'any', 'majority', 'sequential')),
  required_approvers  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  requested_by_actor_id uuid      NOT NULL REFERENCES actor(id),
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  resolution          jsonb,
  expires_at          timestamptz,
  resolved_at         timestamptz,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX approval_request_tenant_idx ON approval_request (tenant_id);
CREATE INDEX approval_request_pending_idx
  ON approval_request (tenant_id, status) WHERE status = 'pending';

ALTER TABLE approval_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY ar_tenant_isolation_select ON approval_request
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ar_tenant_isolation_insert ON approval_request
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ar_tenant_isolation_update ON approval_request
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- approval_response  (individual approver responses; append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE approval_response (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  approval_request_id uuid        NOT NULL REFERENCES approval_request(id),
  responder_actor_id  uuid        NOT NULL REFERENCES actor(id),
  response            text        NOT NULL
                                  CHECK (response IN ('approve', 'reject', 'abstain')),
  comment             text,
  responded_at        timestamptz NOT NULL DEFAULT now(),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX approval_response_tenant_idx ON approval_response (tenant_id);
CREATE INDEX approval_response_request_idx ON approval_response (tenant_id, approval_request_id);

ALTER TABLE approval_response ENABLE ROW LEVEL SECURITY;

CREATE POLICY arsp_tenant_isolation_select ON approval_response
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY arsp_tenant_isolation_insert ON approval_response
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY arsp_no_update ON approval_response FOR UPDATE USING (false);
CREATE POLICY arsp_no_delete ON approval_response FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- policy_definition  (versioned rules with explicit binding strategy)
-- -----------------------------------------------------------------------------

CREATE TABLE policy_definition (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  policy_name         text        NOT NULL,
  display_name        text        NOT NULL,
  description         text,
  policy_kind         text        NOT NULL DEFAULT 'general',
  rules               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  binding_strategy    text        NOT NULL DEFAULT 'at_start'
                                  CHECK (binding_strategy IN ('at_start', 'at_evaluation', 'always_current')),
  version             integer     NOT NULL DEFAULT 1,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'deprecated')),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX policy_definition_tenant_idx ON policy_definition (tenant_id);
CREATE INDEX policy_definition_lookup_idx
  ON policy_definition (tenant_id, policy_name, version DESC);

ALTER TABLE policy_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY pd_tenant_isolation_select ON policy_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY pd_tenant_isolation_insert ON policy_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY pd_tenant_isolation_update ON policy_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
