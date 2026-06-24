-- =============================================================================
-- Seed 0001: Clean substrate initial data (customer-agnostic)
-- A development tenant, system + human + agent actors, and the system-defined
-- kinds that ship with the substrate (ARCHITECTURE.md Layer 2). NO vertical /
-- customer-specific data. Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.
--
-- UUID scheme:
--   tenant    00000000-0000-0000-0000-000000000001
--   actors    00000000-0000-0000-0001-00000000000N
--   ent kind  00000000-0000-0000-0010-00000000000N
--   attr kind 00000000-0000-0000-0011-00000000000N
--   rel kind  00000000-0000-0000-0012-00000000000N
--   act kind  00000000-0000-0000-0013-00000000000N
-- =============================================================================

-- Owner-run migration bypasses RLS, but set the context defensively so any
-- tenant-scoped WITH CHECK policies are satisfied.
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- -----------------------------------------------------------------------------
-- Tenant
-- -----------------------------------------------------------------------------
INSERT INTO tenant (id, name, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Exsto Dev', 'active')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Actors: one system actor, two humans (reference-app dogfood), one AI agent
-- -----------------------------------------------------------------------------
INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status) VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'system', 'system', 'System', 'active'),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'human', NULL, 'Founder', 'active'),
  ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'human', NULL, 'Second User', 'active'),
  ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'agent', 'claude', 'Claude', 'active')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Action kinds: the universal generic write vocabulary (invariants 9, 10, 11, 22)
-- -----------------------------------------------------------------------------
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-0013-000000000001', '00000000-0000-0000-0000-000000000001', 'system.bootstrap',    'System bootstrap',     'Substrate bootstrap / seed action.',      'autonomous', 'irreversible',                     NULL,                 false),
  ('00000000-0000-0000-0013-000000000002', '00000000-0000-0000-0000-000000000001', 'entity.create',       'Create entity',        'Create a new entity.',                    'autonomous', 'fully_reversible',                 'entity.archive',     false),
  ('00000000-0000-0000-0013-000000000003', '00000000-0000-0000-0000-000000000001', 'entity.update',       'Update entity',        'Update an entity''s core fields.',         'autonomous', 'fully_reversible',                 NULL,                 false),
  ('00000000-0000-0000-0013-000000000004', '00000000-0000-0000-0000-000000000001', 'entity.archive',      'Archive entity',       'Archive an entity.',                      'notify',     'reversible_with_state_decay',      'entity.create',      false),
  ('00000000-0000-0000-0013-000000000005', '00000000-0000-0000-0000-000000000001', 'attribute.set',       'Set attribute',        'Record a new attribute observation.',     'autonomous', 'fully_reversible',                 NULL,                 false),
  ('00000000-0000-0000-0013-000000000006', '00000000-0000-0000-0000-000000000001', 'relationship.create', 'Create relationship',  'Create a relationship between entities.',  'autonomous', 'fully_reversible',                 'relationship.close', false),
  ('00000000-0000-0000-0013-000000000007', '00000000-0000-0000-0000-000000000001', 'relationship.close',  'Close relationship',   'Close a relationship (set valid_to).',     'autonomous', 'reversible_with_state_decay',      NULL,                 false),
  ('00000000-0000-0000-0013-000000000008', '00000000-0000-0000-0000-000000000001', 'event.record',        'Record event',         'Record an immutable event.',              'autonomous', 'irreversible',                     NULL,                 false),
  ('00000000-0000-0000-0013-000000000009', '00000000-0000-0000-0000-000000000001', 'judgment.record',     'Record judgment',      'Record a judgment about an entity.',      'autonomous', 'fully_reversible',                 NULL,                 false),
  ('00000000-0000-0000-0013-00000000000a', '00000000-0000-0000-0000-000000000001', 'outcome.record',      'Record outcome',       'Record a realized outcome.',              'notify',     'reversible_with_state_decay',      NULL,                 false),
  ('00000000-0000-0000-0013-00000000000b', '00000000-0000-0000-0000-000000000001', 'identity.assert',     'Assert identity',      'Assert two entities are same/different.',  'notify',     'reversible_with_external_caveats', NULL,                 false),
  ('00000000-0000-0000-0013-00000000000c', '00000000-0000-0000-0000-000000000001', 'config.change',       'Change configuration', 'Author or modify configuration data.',     'approve',    'reversible_with_state_decay',      NULL,                 false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- System-defined entity kinds (ARCHITECTURE.md Layer 2). Capability flags per
-- migration 0012. Tenants extend these via additional definition rows.
-- -----------------------------------------------------------------------------
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-0010-000000000001', '00000000-0000-0000-0000-000000000001', 'person',       'Person',       'A natural person.',                         true, true,  false, false),
  ('00000000-0000-0000-0010-000000000002', '00000000-0000-0000-0000-000000000001', 'organization', 'Organization', 'A company or other organization.',          true, true,  false, false),
  ('00000000-0000-0000-0010-000000000003', '00000000-0000-0000-0000-000000000001', 'contact',      'Contact',      'A point of contact.',                       true, true,  false, false),
  ('00000000-0000-0000-0010-000000000004', '00000000-0000-0000-0000-000000000001', 'deal',         'Deal',         'A sales/engagement opportunity.',           true, true,  true,  false),
  ('00000000-0000-0000-0010-000000000005', '00000000-0000-0000-0000-000000000001', 'document',     'Document',     'A document entity (see document_version).',  true, false, false, false),
  ('00000000-0000-0000-0010-000000000006', '00000000-0000-0000-0000-000000000001', 'location',     'Location',     'A physical or logical location.',           true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- System-defined attribute kinds. Generic, broadly applicable (on_entity_kind_id
-- left NULL = not restricted to one entity kind).
-- -----------------------------------------------------------------------------
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, value_type, is_pii) VALUES
  ('00000000-0000-0000-0011-000000000001', '00000000-0000-0000-0000-000000000001', 'full_name',   'Full name',   'A person or entity full name.', 'text',     true),
  ('00000000-0000-0000-0011-000000000002', '00000000-0000-0000-0000-000000000001', 'email',       'Email',       'An email address.',             'text',     true),
  ('00000000-0000-0000-0011-000000000003', '00000000-0000-0000-0000-000000000001', 'phone',       'Phone',       'A phone number.',               'text',     true),
  ('00000000-0000-0000-0011-000000000004', '00000000-0000-0000-0000-000000000001', 'status',      'Status',      'A generic status value.',       'enum',     false),
  ('00000000-0000-0000-0011-000000000005', '00000000-0000-0000-0000-000000000001', 'description', 'Description', 'A free-text description.',      'text',     false),
  ('00000000-0000-0000-0011-000000000006', '00000000-0000-0000-0000-000000000001', 'amount',      'Amount',      'A monetary amount.',            'money',    false),
  ('00000000-0000-0000-0011-000000000007', '00000000-0000-0000-0000-000000000001', 'due_date',    'Due date',    'A due date/time.',              'datetime', false),
  ('00000000-0000-0000-0011-000000000008', '00000000-0000-0000-0000-000000000001', 'start_date',  'Start date',  'A start date.',                 'date',     false),
  ('00000000-0000-0000-0011-000000000009', '00000000-0000-0000-0000-000000000001', 'end_date',    'End date',    'An end date.',                  'date',     false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- System-defined relationship kinds.
-- -----------------------------------------------------------------------------
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-0012-000000000001', '00000000-0000-0000-0000-000000000001', 'belongs_to', 'Belongs to', 'Source belongs to target.',     'many_to_one',  'directed',   'has'),
  ('00000000-0000-0000-0012-000000000002', '00000000-0000-0000-0000-000000000001', 'related_to', 'Related to', 'Generic association.',          'many_to_many', 'undirected', NULL),
  ('00000000-0000-0000-0012-000000000003', '00000000-0000-0000-0000-000000000001', 'part_of',    'Part of',    'Source is a part of target.',   'many_to_one',  'directed',   'has_part'),
  ('00000000-0000-0000-0012-000000000004', '00000000-0000-0000-0000-000000000001', 'reports_to', 'Reports to', 'Source reports to target.',     'many_to_one',  'directed',   'manages'),
  ('00000000-0000-0000-0012-000000000005', '00000000-0000-0000-0000-000000000001', 'located_at', 'Located at', 'Source located at a location.', 'many_to_one',  'directed',   'location_of')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- System-defined event / judgment / outcome kinds (generic starters).
-- -----------------------------------------------------------------------------
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-0014-000000000001', '00000000-0000-0000-0000-000000000001', 'observation',   'Observation',   'A generic observed event.',  false),
  ('00000000-0000-0000-0014-000000000002', '00000000-0000-0000-0000-000000000001', 'state_changed', 'State changed', 'An entity state change.',    true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO judgment_kind_definition
  (id, tenant_id, kind_name, display_name, description, value_type) VALUES
  ('00000000-0000-0000-0015-000000000001', '00000000-0000-0000-0000-000000000001', 'assessment', 'Assessment', 'A generic qualitative assessment.', 'structured'),
  ('00000000-0000-0000-0015-000000000002', '00000000-0000-0000-0000-000000000001', 'rating',     'Rating',     'A numeric rating.',                 'rating')
ON CONFLICT (id) DO NOTHING;

INSERT INTO outcome_kind_definition
  (id, tenant_id, kind_name, display_name, description, polarity, is_terminal) VALUES
  ('00000000-0000-0000-0016-000000000001', '00000000-0000-0000-0000-000000000001', 'completed', 'Completed', 'A positive terminal outcome.', 'positive', true),
  ('00000000-0000-0000-0016-000000000002', '00000000-0000-0000-0000-000000000001', 'cancelled', 'Cancelled', 'A neutral terminal outcome.',  'neutral',  true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Extended generic action kinds for the full primitive write surface. Idempotent
-- via NOT EXISTS on (tenant_id, kind_name); UUIDs are auto-generated.
-- -----------------------------------------------------------------------------
INSERT INTO action_kind_definition
  (tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, requires_reasoning_trace)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, v.kind_name, v.display_name, NULL, v.tier, v.rev, false
FROM (VALUES
  ('kind.define',                  'Define kind',                  'approve',    'reversible_with_state_decay'),
  ('workflow.define',              'Define workflow',              'approve',    'reversible_with_state_decay'),
  ('workflow.start',               'Start workflow',               'autonomous', 'fully_reversible'),
  ('workflow.advance',             'Advance workflow',             'autonomous', 'reversible_with_state_decay'),
  ('approval.request',             'Request approval',             'notify',     'fully_reversible'),
  ('approval.respond',             'Respond to approval',          'autonomous', 'irreversible'),
  ('policy.define',                'Define policy',                'approve',    'reversible_with_state_decay'),
  ('permission_scope.define',      'Define permission scope',      'approve',    'reversible_with_state_decay'),
  ('actor_scope.assign',           'Assign permission scope',      'approve',    'fully_reversible'),
  ('trigger.define',               'Define trigger',               'approve',    'reversible_with_state_decay'),
  ('notification_route.define',    'Define notification route',    'approve',    'reversible_with_state_decay'),
  ('subscription.create',          'Create subscription',          'autonomous', 'fully_reversible'),
  ('period.open',                  'Open period',                  'notify',     'fully_reversible'),
  ('period.close',                 'Close period',                 'approve',    'reversible_with_external_caveats'),
  ('ownership.assign',             'Assign ownership',             'notify',     'fully_reversible'),
  ('role.define',                  'Define role',                  'approve',    'reversible_with_state_decay'),
  ('role.assign',                  'Assign role',                  'notify',     'fully_reversible'),
  ('hierarchy.define',             'Define hierarchy',             'approve',    'reversible_with_state_decay'),
  ('hierarchy.set_membership',     'Set hierarchy membership',     'autonomous', 'fully_reversible'),
  ('collection.define',            'Define collection',            'notify',     'reversible_with_state_decay'),
  ('commitment.create',            'Create commitment',            'autonomous', 'fully_reversible'),
  ('commitment.fulfill',           'Fulfill commitment',           'autonomous', 'reversible_with_state_decay'),
  ('thread.start',                 'Start communication thread',   'autonomous', 'fully_reversible'),
  ('message.append',               'Append message',               'autonomous', 'irreversible'),
  ('stakeholder.set',              'Set stakeholder position',     'autonomous', 'fully_reversible'),
  ('causal.claim',                 'Assert causal claim',          'autonomous', 'irreversible'),
  ('contestation.open',            'Open contestation',            'autonomous', 'reversible_with_state_decay'),
  ('contestation.update',          'Update contestation',          'autonomous', 'irreversible'),
  ('reasoning.capture',            'Capture reasoning trace',      'autonomous', 'irreversible'),
  ('access.record',                'Record access',                'autonomous', 'irreversible'),
  ('content_blob.store',           'Store content blob',           'autonomous', 'irreversible'),
  ('document.add_version',         'Add document version',         'notify',     'reversible_with_state_decay'),
  ('raw_event.ingest',             'Ingest raw event',             'autonomous', 'irreversible'),
  ('source_record.link',           'Link source record',          'autonomous', 'fully_reversible'),
  ('integration_mapping.define',   'Define integration mapping',   'approve',    'reversible_with_state_decay'),
  ('authoritative_source.designate','Designate authoritative source','approve',  'reversible_with_state_decay'),
  ('conflict_rule.define',         'Define conflict resolution rule','approve',  'reversible_with_state_decay')
) AS v(kind_name, display_name, tier, rev)
WHERE NOT EXISTS (
  SELECT 1 FROM action_kind_definition a
   WHERE a.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid AND a.kind_name = v.kind_name
);

-- =============================================================================
-- ADR 0045 workflow ENGINE kinds — fresh-DB resilience.
--
-- These are the kinds the configurable workflow engine's write path needs. They
-- normally arrive via the legal VERTICAL migrations (migrations_vertical/), but a
-- fresh substrate that replays only the CORE migrations + this seed would lack
-- them, so the engine's handlers (legal.matter.advance, legal.service.set_lifecycle,
-- legal.matter.set_workflow, the workflow_step_template lifecycle) would fail to
-- dispatch. Copied VERBATIM (same ids) from the vertical migrations so a re-apply of
-- those migrations is a perfect no-op (ON CONFLICT (id) DO NOTHING):
--   migrations_vertical/0093_workflow_engine.sql       (legal.matter.advance, workflow.advanced)
--   migrations_vertical/0094_service_set_lifecycle.sql (legal.service.set_lifecycle)
--   migrations_vertical/0107_workflow_step_library.sql (workflow_step_template entity + attrs + create/update)
--   migrations_vertical/0108_matter_set_workflow.sql   (legal.matter.set_workflow, workflow.customized)
-- Idempotent; configuration-as-data; flag-gated at runtime (LEGAL_WORKFLOW_ENGINE).
-- =============================================================================

-- ── Action kinds (0093 / 0094 / 0107 / 0108) ─────────────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000a01', '00000000-0000-0000-0000-000000000001',
   'legal.matter.advance', 'Advance matter through workflow',
   'Advance one matter one step through its bound lifecycle (ADR 0045). Manual gate path (attorney/client continue/approve) and the wrapper a system callback uses. Mirrors matter_status and emits workflow.advanced. Guarded against the bound graph: an illegal transition is rejected.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000a02', '00000000-0000-0000-0000-000000000001',
   'legal.service.set_lifecycle', 'Author service workflow lifecycle',
   'Author the lifecycle stage graph onto a service''s workflow_definition.states (ADR 0045). Versioned: seals the prior active service version and inserts version+1, replacing states with the validated graph while carrying display_name/description/transitions/participating_entity_kinds forward unchanged. The matter Workflow builder save path (and the SMLLC author script) use this.',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000a03', '00000000-0000-0000-0000-000000000001',
   'legal.workflow_step_template.create', 'Create workflow step template',
   'Create a standalone, reusable workflow step (a LifecycleStage without edges) in the firm library.',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000a04', '00000000-0000-0000-0000-000000000001',
   'legal.workflow_step_template.update', 'Update workflow step template',
   'Update a standalone workflow step template (append-only attribute supersession).',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000a05', '00000000-0000-0000-0000-000000000001',
   'legal.matter.set_workflow', 'Customize this matter''s workflow',
   'Replace ONE matter''s lifecycle graph (add/reorder/remove a step) by writing workflow_instance.states_override, WITHOUT altering the service default (workflow_definition.states). The new graph is validated (closed step-action vocabulary + linear) and rejected if it would orphan the matter''s current step. Fully reversible: set another override or clear it back to the bound graph.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Event kinds (0093 / 0108) ────────────────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000a01', '00000000-0000-0000-0000-000000000001',
   'workflow.advanced', 'Workflow advanced',
   'A matter advanced from one lifecycle stage to another (ADR 0045). payload holds {from, to, gate, trigger}. Primary=matter.',
   true),
  ('00000000-0000-0000-1014-000000000a02', '00000000-0000-0000-0000-000000000001',
   'workflow.customized', 'Workflow customized',
   'A matter''s workflow GRAPH was customized for that matter only (ADR 0045). This changes the instance''s graph, not its current_state, so is_state_change=false (unlike workflow.advanced). payload holds {stage_count}. Primary=matter.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── workflow_step_template entity kind (0107) ────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000a01', '00000000-0000-0000-0000-000000000001',
   'workflow_step_template', 'Workflow step template',
   'A reusable workflow STEP (a LifecycleStage without edges) saved from the Workflow builder and droppable into any service.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── workflow_step_template attribute kinds (0107) ────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000a01', '00000000-0000-0000-0000-000000000001',
   'workflow_step_template_name', 'Step name', 'Human name of the saved step.',
   '00000000-0000-0000-1010-000000000a01', 'text', false),
  ('00000000-0000-0000-1011-000000000a02', '00000000-0000-0000-0000-000000000001',
   'workflow_step_template_description', 'Step description',
   'Optional short description of what this saved step is for.',
   '00000000-0000-0000-1010-000000000a01', 'text', false),
  ('00000000-0000-0000-1011-000000000a03', '00000000-0000-0000-0000-000000000001',
   'workflow_step_template_stage', 'Step stage',
   'The reusable LifecycleStage (label, action {kind,config?}, gate, documents?, blocking?) — WITHOUT advances_to. The builder assigns edges at insertion time.',
   '00000000-0000-0000-1010-000000000a01', 'json', false)
ON CONFLICT (id) DO NOTHING;
