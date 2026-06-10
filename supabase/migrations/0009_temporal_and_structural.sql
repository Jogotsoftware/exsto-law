-- =============================================================================
-- Migration 0009: Temporal and structural primitives
-- period (+ period_kind_definition), hierarchy_definition + hierarchy_membership,
-- collection_definition, ownership_assignment, role_definition + role_assignment,
-- commitment, communication_thread + communication_message, stakeholder_position.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- period_kind_definition  (registry; follows the 0002 definition-table pattern)
-- -----------------------------------------------------------------------------

CREATE TABLE period_kind_definition (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenant(id),
  kind_name              text        NOT NULL,
  display_name           text        NOT NULL,
  description            text,
  fiscal_year_start_month integer    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  applicable_entity_kinds jsonb      NOT NULL DEFAULT '[]'::jsonb,
  metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from             timestamptz NOT NULL DEFAULT now(),
  valid_to               timestamptz,
  status                 text        NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'deprecated')),
  recorded_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX period_kind_definition_tenant_idx ON period_kind_definition (tenant_id);
CREATE INDEX period_kind_definition_lookup_idx
  ON period_kind_definition (tenant_id, kind_name, valid_from DESC);

ALTER TABLE period_kind_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY pkd_tenant_isolation_select ON period_kind_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY pkd_tenant_isolation_insert ON period_kind_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY pkd_tenant_isolation_update ON period_kind_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- period  (time interval; close is an explicit gating mechanism, invariant 11)
-- -----------------------------------------------------------------------------

CREATE TABLE period (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenant(id),
  action_id        uuid        NOT NULL REFERENCES action(id),
  period_kind_id   uuid        NOT NULL REFERENCES period_kind_definition(id),
  name             text        NOT NULL,
  start_date       date        NOT NULL,
  end_date         date        NOT NULL,
  parent_period_id uuid        REFERENCES period(id),
  status           text        NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open', 'closed', 'restated')),
  closed_at        timestamptz,
  metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from       timestamptz NOT NULL DEFAULT now(),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX period_tenant_idx ON period (tenant_id);
CREATE INDEX period_kind_idx ON period (tenant_id, period_kind_id);
CREATE INDEX period_range_idx ON period (tenant_id, start_date, end_date);

ALTER TABLE period ENABLE ROW LEVEL SECURITY;

CREATE POLICY period_tenant_isolation_select ON period
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY period_tenant_isolation_insert ON period
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY period_tenant_isolation_update ON period
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- hierarchy_definition  (named hierarchies; multiple per entity kind allowed)
-- -----------------------------------------------------------------------------

CREATE TABLE hierarchy_definition (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id),
  action_id      uuid        NOT NULL REFERENCES action(id),
  hierarchy_name text        NOT NULL,
  display_name   text        NOT NULL,
  description    text,
  entity_kind_id uuid        REFERENCES entity_kind_definition(id),
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  status         text        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'deprecated')),
  recorded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hierarchy_definition_tenant_idx ON hierarchy_definition (tenant_id);

ALTER TABLE hierarchy_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY hd_tenant_isolation_select ON hierarchy_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY hd_tenant_isolation_insert ON hierarchy_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY hd_tenant_isolation_update ON hierarchy_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- hierarchy_membership  (an entity's position in a hierarchy at a time)
-- -----------------------------------------------------------------------------

CREATE TABLE hierarchy_membership (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenant(id),
  action_id              uuid        NOT NULL REFERENCES action(id),
  hierarchy_definition_id uuid       NOT NULL REFERENCES hierarchy_definition(id),
  entity_id              uuid        NOT NULL REFERENCES entity(id),
  parent_entity_id       uuid        REFERENCES entity(id),
  position_metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from             timestamptz NOT NULL DEFAULT now(),
  valid_to               timestamptz,
  recorded_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hierarchy_membership_tenant_idx ON hierarchy_membership (tenant_id);
CREATE INDEX hierarchy_membership_entity_idx
  ON hierarchy_membership (tenant_id, hierarchy_definition_id, entity_id, valid_from DESC);
CREATE INDEX hierarchy_membership_parent_idx
  ON hierarchy_membership (tenant_id, hierarchy_definition_id, parent_entity_id);

ALTER TABLE hierarchy_membership ENABLE ROW LEVEL SECURITY;

CREATE POLICY hm_tenant_isolation_select ON hierarchy_membership
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY hm_tenant_isolation_insert ON hierarchy_membership
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY hm_tenant_isolation_update ON hierarchy_membership
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- collection_definition  (sets of entities with identity; static or dynamic)
-- Static membership is expressed via relationship rows; dynamic membership via
-- the criteria expression. The collection itself is a first-class definition.
-- -----------------------------------------------------------------------------

CREATE TABLE collection_definition (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id),
  action_id       uuid        NOT NULL REFERENCES action(id),
  collection_name text        NOT NULL,
  display_name    text        NOT NULL,
  description     text,
  collection_type text        NOT NULL DEFAULT 'static'
                              CHECK (collection_type IN ('static', 'dynamic')),
  criteria        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  entity_kind_id  uuid        REFERENCES entity_kind_definition(id),
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'deprecated')),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collection_definition_tenant_idx ON collection_definition (tenant_id);

ALTER TABLE collection_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY cd_tenant_isolation_select ON collection_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cd_tenant_isolation_insert ON collection_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cd_tenant_isolation_update ON collection_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- ownership_assignment  (which actor owns which entity; accountability)
-- Distinct from role_assignment (job role) and permission scope (authorization).
-- -----------------------------------------------------------------------------

CREATE TABLE ownership_assignment (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenant(id),
  action_id      uuid        NOT NULL REFERENCES action(id),
  entity_id      uuid        NOT NULL REFERENCES entity(id),
  owner_actor_id uuid        NOT NULL REFERENCES actor(id),
  ownership_kind text        NOT NULL DEFAULT 'primary'
                             CHECK (ownership_kind IN ('primary', 'secondary', 'reviewer', 'approver_for')),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  recorded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ownership_assignment_tenant_idx ON ownership_assignment (tenant_id);
CREATE INDEX ownership_assignment_entity_idx
  ON ownership_assignment (tenant_id, entity_id, valid_from DESC);
CREATE INDEX ownership_assignment_owner_idx ON ownership_assignment (tenant_id, owner_actor_id);

ALTER TABLE ownership_assignment ENABLE ROW LEVEL SECURITY;

CREATE POLICY oa_tenant_isolation_select ON ownership_assignment
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY oa_tenant_isolation_insert ON ownership_assignment
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY oa_tenant_isolation_update ON ownership_assignment
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- role_definition  (named positions with default permission scopes)
-- -----------------------------------------------------------------------------

CREATE TABLE role_definition (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenant(id),
  action_id               uuid        NOT NULL REFERENCES action(id),
  role_name               text        NOT NULL,
  display_name            text        NOT NULL,
  description             text,
  default_permission_scopes jsonb     NOT NULL DEFAULT '[]'::jsonb,
  valid_from              timestamptz NOT NULL DEFAULT now(),
  valid_to                timestamptz,
  status                  text        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active', 'deprecated')),
  recorded_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX role_definition_tenant_idx ON role_definition (tenant_id);

ALTER TABLE role_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY rd_tenant_isolation_select ON role_definition
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY rd_tenant_isolation_insert ON role_definition
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY rd_tenant_isolation_update ON role_definition
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- role_assignment  (ties a person entity to a role, with reporting + validity)
-- -----------------------------------------------------------------------------

CREATE TABLE role_assignment (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  role_definition_id  uuid        NOT NULL REFERENCES role_definition(id),
  person_entity_id    uuid        NOT NULL REFERENCES entity(id),
  org_unit_entity_id  uuid        REFERENCES entity(id),
  reports_to_assignment_id uuid   REFERENCES role_assignment(id),
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX role_assignment_tenant_idx ON role_assignment (tenant_id);
CREATE INDEX role_assignment_person_idx ON role_assignment (tenant_id, person_entity_id, valid_from DESC);
CREATE INDEX role_assignment_role_idx ON role_assignment (tenant_id, role_definition_id);

ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;

CREATE POLICY ra_tenant_isolation_select ON role_assignment
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ra_tenant_isolation_insert ON role_assignment
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ra_tenant_isolation_update ON role_assignment
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- commitment  (a time-bound obligation: SLA, milestone, deadline, promise)
-- -----------------------------------------------------------------------------

CREATE TABLE commitment (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id),
  action_id         uuid        NOT NULL REFERENCES action(id),
  commitment_kind   text        NOT NULL DEFAULT 'deadline'
                                CHECK (commitment_kind IN ('sla', 'milestone', 'deadline', 'promise')),
  subject_entity_id uuid        REFERENCES entity(id),
  description       text        NOT NULL,
  due_at            timestamptz NOT NULL,
  due_at_precision  text        NOT NULL DEFAULT 'exact_instant'
                                CHECK (due_at_precision IN (
                                  'exact_instant', 'second', 'minute', 'hour',
                                  'day', 'week', 'month', 'quarter', 'year',
                                  'range', 'approximate', 'unknown')),
  threshold_at      timestamptz,
  fulfilled_at      timestamptz,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'fulfilled', 'breached', 'cancelled')),
  consequences      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  valid_from        timestamptz NOT NULL DEFAULT now(),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX commitment_tenant_idx ON commitment (tenant_id);
CREATE INDEX commitment_subject_idx ON commitment (tenant_id, subject_entity_id);
CREATE INDEX commitment_due_idx ON commitment (tenant_id, status, due_at);

ALTER TABLE commitment ENABLE ROW LEVEL SECURITY;

CREATE POLICY commitment_tenant_isolation_select ON commitment
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY commitment_tenant_isolation_insert ON commitment
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY commitment_tenant_isolation_update ON commitment
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- communication_thread  (a series of related messages between actors)
-- -----------------------------------------------------------------------------

CREATE TABLE communication_thread (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id),
  action_id         uuid        NOT NULL REFERENCES action(id),
  thread_kind       text        NOT NULL
                                CHECK (thread_kind IN ('email', 'slack', 'sms', 'call_series', 'meeting_series')),
  subject           text,
  participants      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  related_entity_ids uuid[]     NOT NULL DEFAULT '{}',
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'closed', 'archived')),
  valid_from        timestamptz NOT NULL DEFAULT now(),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX communication_thread_tenant_idx ON communication_thread (tenant_id);

ALTER TABLE communication_thread ENABLE ROW LEVEL SECURITY;

CREATE POLICY ct_tenant_isolation_select ON communication_thread
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ct_tenant_isolation_insert ON communication_thread
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ct_tenant_isolation_update ON communication_thread
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- communication_message  (a message in a thread; immutable / append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE communication_message (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenant(id),
  action_id         uuid        NOT NULL REFERENCES action(id),
  thread_id         uuid        NOT NULL REFERENCES communication_thread(id),
  sender_actor_id   uuid        REFERENCES actor(id),
  sender_entity_id  uuid        REFERENCES entity(id),
  body_blob_id      uuid        REFERENCES content_blob(id),
  body_preview      text,
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_type       text        NOT NULL
                                CHECK (source_type IN ('human', 'integration', 'agent', 'system')),
  source_ref        text,
  occurred_at       timestamptz NOT NULL,
  occurred_at_precision text    NOT NULL DEFAULT 'exact_instant'
                                CHECK (occurred_at_precision IN (
                                  'exact_instant', 'second', 'minute', 'hour',
                                  'day', 'week', 'month', 'quarter', 'year',
                                  'range', 'approximate', 'unknown')),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX communication_message_tenant_idx ON communication_message (tenant_id);
CREATE INDEX communication_message_thread_idx
  ON communication_message (tenant_id, thread_id, occurred_at);

ALTER TABLE communication_message ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_tenant_isolation_select ON communication_message
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cm_tenant_isolation_insert ON communication_message
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cm_no_update ON communication_message FOR UPDATE USING (false);
CREATE POLICY cm_no_delete ON communication_message FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- stakeholder_position  (a stakeholder's role + stance on a decision)
-- Temporal and superseded; specific enough to deserve its own primitive.
-- -----------------------------------------------------------------------------

CREATE TABLE stakeholder_position (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id),
  action_id           uuid        NOT NULL REFERENCES action(id),
  subject_entity_id   uuid        NOT NULL REFERENCES entity(id),
  stakeholder_entity_id uuid      NOT NULL REFERENCES entity(id),
  position_role       text        NOT NULL
                                  CHECK (position_role IN ('champion', 'economic_buyer', 'influencer', 'blocker', 'neutral')),
  stance              text        NOT NULL DEFAULT 'neutral'
                                  CHECK (stance IN ('strongly_favorable', 'favorable', 'neutral', 'unfavorable', 'opposed')),
  influence           numeric     CHECK (influence >= 0 AND influence <= 1),
  confidence          numeric     NOT NULL DEFAULT 1.0
                                  CHECK (confidence >= 0 AND confidence <= 1),
  source_type         text        NOT NULL
                                  CHECK (source_type IN ('human', 'integration', 'agent', 'system')),
  source_ref          text,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stakeholder_position_tenant_idx ON stakeholder_position (tenant_id);
CREATE INDEX stakeholder_position_subject_idx
  ON stakeholder_position (tenant_id, subject_entity_id, valid_from DESC);
CREATE INDEX stakeholder_position_stakeholder_idx
  ON stakeholder_position (tenant_id, stakeholder_entity_id);

ALTER TABLE stakeholder_position ENABLE ROW LEVEL SECURITY;

CREATE POLICY sp_tenant_isolation_select ON stakeholder_position
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sp_tenant_isolation_insert ON stakeholder_position
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sp_tenant_isolation_update ON stakeholder_position
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
