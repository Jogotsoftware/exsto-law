-- =============================================================================
-- Vertical migration 0020: Client as the parent entity (beta sprint Objective 1)
--
-- Today contacts and matters are flat — each matter is client_of-linked straight
-- to a client_contact, with no grouping. The pilot model makes CLIENT the parent:
--   Client 1→many client_contact   (relationship: contact_of)
--   Client 1→many matter            (relationship: matter_of)
-- The spec's relational "client_id FK on contacts and matters" is realized the
-- substrate-native way as directed relationships (a contact / matter points at
-- its parent client). Definitions only — app data (the client entities + the
-- re-parenting) is created THROUGH THE CORE by the reseed (Objective 12), never
-- by raw SQL here.
--
-- Client settings (Objective 3) live as attributes on the client: a billable rate
-- (decimal STRING, ADR 0044), a billing type (hourly | fixed), and a main-contact
-- pointer. Ids verified free against the live pilot DB (entity ≤0006, attribute
-- ≤0026, relationship ≤0005, action ≤0018).
--
-- Configuration-as-data: every new concept is a definition row. Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── Client entity kind ───────────────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000007', '00000000-0000-0000-0000-000000000001',
   'client', 'Client', 'A firm client — the parent grouping its contacts and matters.',
   NULL, true, true, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── Client attributes (settings) ─────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000027', '00000000-0000-0000-0000-000000000001',
   'client_name',         'Client name',    'The client / account name (individual or company).',
   '00000000-0000-0000-1010-000000000007', 'text',   true),
  ('00000000-0000-0000-1011-000000000028', '00000000-0000-0000-0000-000000000001',
   'client_billable_rate','Billable rate',  'Default billable rate for the client, a decimal string (ADR 0044).',
   '00000000-0000-0000-1010-000000000007', 'text',   false),
  ('00000000-0000-0000-1011-000000000029', '00000000-0000-0000-0000-000000000001',
   'client_billing_type', 'Billing type',   'hourly | fixed — how this client is billed by default.',
   '00000000-0000-0000-1010-000000000007', 'enum',   false),
  ('00000000-0000-0000-1011-000000000030', '00000000-0000-0000-0000-000000000001',
   'client_main_contact', 'Main contact',   'Entity id of the client_contact designated as the main contact.',
   '00000000-0000-0000-1010-000000000007', 'text',   false)
ON CONFLICT (id) DO NOTHING;

-- ── Parent/child relationships ───────────────────────────────────────────────
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000006', '00000000-0000-0000-0000-000000000001',
   'contact_of', 'Contact of', 'A client contact belongs to a client (the parent).',
   '00000000-0000-0000-1010-000000000002', '00000000-0000-0000-1010-000000000007', 'many_to_one', 'directed', 'has_contact'),
  ('00000000-0000-0000-1012-000000000007', '00000000-0000-0000-0000-000000000001',
   'matter_of', 'Matter of', 'A matter belongs to a client (the parent).',
   '00000000-0000-0000-1010-000000000001', '00000000-0000-0000-1010-000000000007', 'many_to_one', 'directed', 'has_matter')
ON CONFLICT (id) DO NOTHING;

-- ── Client lifecycle actions (writes go through these handlers) ──────────────
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000019', '00000000-0000-0000-0000-000000000001',
   'legal.client.create', 'Create client', 'Create a client parent and attach its contacts/matters.',
   'autonomous', 'reversible_with_state_decay', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000020', '00000000-0000-0000-0000-000000000001',
   'legal.client.update', 'Update client', 'Update client settings (billable rate, billing type, main contact) or re-parent a contact/matter.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
