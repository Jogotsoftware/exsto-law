-- =============================================================================
-- Vertical migration 0067: Company as a first-class CRM entity.
--
-- The CRM is organized around the COMPANY (the account/organization). People are
-- contacts that belong to a company; matters attach to a company AND connect to
-- one or more contacts. A "client" is a company whose engagement_status = 'client'
-- (vs 'prospect' / 'inactive') — so the CRM's Clients tab is a filtered view over
-- companies, and clients + contacts live in one unified CRM.
--
--   Company 1--many Contact   (contact --contact_of_company--> company)
--   Company 1--many Matter    (matter  --matter_of_company--> company)
--   Matter  many--many Contact (matter --matter_contact--> contact)
--
-- The substrate stores 1-to-many as a many_to_one from the child + an inverse
-- name (the "1" side). many-to-many is stored directly. This is config-as-data
-- (ADR 0012): every concept is a definition row, idempotent (ON CONFLICT). App
-- data — the company entities + the re-parenting of existing contacts/matters —
-- is created THROUGH THE CORE by the backfill (0068), never by raw SQL here.
--
-- Ids verified free against the live DB: entity/attribute/relationship/action
-- suffixes all use the 000000000600 block (above every prior max). The company's
-- display name is entity.name (set at create) — no separate name attribute, to
-- avoid an ambiguous duplicate of the existing contact 'company_name' kind.
-- Lease 0067-0071; uses 0067 only.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── Company entity kind ──────────────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000600', '00000000-0000-0000-0000-000000000001',
   'company', 'Company',
   'A company / organization — the CRM account that groups its contacts and matters. A company with engagement_status = ''client'' is a client.',
   NULL, true, true, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── Company attributes (account settings) ────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000600', '00000000-0000-0000-0000-000000000001',
   'company_engagement_status', 'Engagement status',
   'prospect | client | inactive — a company with ''client'' is a firm client (drives the CRM Clients tab).',
   '00000000-0000-0000-1010-000000000600', 'enum', false),
  ('00000000-0000-0000-1011-000000000601', '00000000-0000-0000-0000-000000000001',
   'company_billable_rate', 'Billable rate',
   'Default billable rate for the company, a decimal money value (ADR 0044).',
   '00000000-0000-0000-1010-000000000600', 'money', false),
  ('00000000-0000-0000-1011-000000000602', '00000000-0000-0000-0000-000000000001',
   'company_billing_type', 'Billing type', 'hourly | fixed — how this company is billed by default.',
   '00000000-0000-0000-1010-000000000600', 'enum', false),
  ('00000000-0000-0000-1011-000000000603', '00000000-0000-0000-0000-000000000001',
   'company_main_contact', 'Main contact', 'Entity id of the client_contact designated as the company''s main contact.',
   '00000000-0000-0000-1010-000000000600', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── Relationships ────────────────────────────────────────────────────────────
-- contact_of_company / matter_of_company: the "many" child points at its one
-- company (many_to_one); the inverse name is the company's "has_*" (1-to-many)
-- side. matter_contact: a matter connects to many contacts and a contact to many
-- matters (many_to_many).
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000600', '00000000-0000-0000-0000-000000000001',
   'contact_of_company', 'Contact of company', 'A contact belongs to a company (the account).',
   '00000000-0000-0000-1010-000000000002', '00000000-0000-0000-1010-000000000600', 'many_to_one', 'directed', 'has_contact'),
  ('00000000-0000-0000-1012-000000000601', '00000000-0000-0000-0000-000000000001',
   'matter_of_company', 'Matter of company', 'A matter belongs to a company (the account).',
   '00000000-0000-0000-1010-000000000001', '00000000-0000-0000-1010-000000000600', 'many_to_one', 'directed', 'has_matter'),
  ('00000000-0000-0000-1012-000000000602', '00000000-0000-0000-0000-000000000001',
   'matter_contact', 'Matter contact', 'A matter connects to one or more contacts (and a contact to many matters).',
   '00000000-0000-0000-1010-000000000001', '00000000-0000-0000-1010-000000000002', 'many_to_many', 'directed', 'contact_matter')
ON CONFLICT (id) DO NOTHING;

-- ── Action kinds (CRM operations through the core) ───────────────────────────
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000600', '00000000-0000-0000-0000-000000000001',
   'company.create', 'Create company', 'Create a CRM company (account) with its name + initial settings.',
   'autonomous', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000601', '00000000-0000-0000-0000-000000000001',
   'company.update', 'Update company', 'Update a company''s name, engagement status, or billing settings (new version supersedes prior).',
   'autonomous', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000602', '00000000-0000-0000-0000-000000000001',
   'contact.set_company', 'Set contact''s company', 'Link a contact to its company (contact_of_company); supersedes any prior company link.',
   'autonomous', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000603', '00000000-0000-0000-0000-000000000001',
   'matter.set_company', 'Set matter''s company', 'Link a matter to its company (matter_of_company); supersedes any prior company link.',
   'autonomous', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000604', '00000000-0000-0000-0000-000000000001',
   'matter.link_contact', 'Link contact to matter', 'Connect a contact to a matter (matter_contact, many-to-many).',
   'autonomous', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
