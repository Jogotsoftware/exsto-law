-- =============================================================================
-- Vertical migration 0024: Saved filter/sort views (beta sprint Objective 5)
--
-- The shared filter/sort component (Matters, Contacts/Clients, Review) needs to
-- save named views — a surface (which list) plus an opaque filter+sort config the
-- UI owns. A saved view is an ENTITY with its own lifecycle: create / update
-- (append-only attribute supersession) / archive (the core entity.archive).
--
-- Scope: firm-wide for the pilot (a solo/small firm). The creator is recorded in
-- view_owner so a future multi-user build can filter to "my views" WITHOUT a
-- schema change — the list is firm-wide today, owner-filterable later.
--
-- Ids verified free against the live pilot DB (entity ≤0008, attribute ≤0034,
-- action ≤0024). Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── saved_view entity kind ───────────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000009', '00000000-0000-0000-0000-000000000001',
   'saved_view', 'Saved view', 'A named filter/sort view for a list surface (Matters, Contacts, Review).',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── saved_view attributes ────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000035', '00000000-0000-0000-0000-000000000001',
   'view_name',    'View name',    'Human name of the saved view.',
   '00000000-0000-0000-1010-000000000009', 'text', false),
  ('00000000-0000-0000-1011-000000000036', '00000000-0000-0000-0000-000000000001',
   'view_surface', 'View surface', 'Which list the view applies to (e.g. matters | contacts | review).',
   '00000000-0000-0000-1010-000000000009', 'text', false),
  ('00000000-0000-0000-1011-000000000037', '00000000-0000-0000-0000-000000000001',
   'view_config',  'View config',  'Opaque filter + sort configuration (JSON, owned by the UI).',
   '00000000-0000-0000-1010-000000000009', 'json', false),
  ('00000000-0000-0000-1011-000000000038', '00000000-0000-0000-0000-000000000001',
   'view_owner',   'View owner',   'Actor id of the creator (firm-wide list today, owner-filterable later).',
   '00000000-0000-0000-1010-000000000009', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── saved_view lifecycle actions (writes go through these handlers) ───────────
-- Deletion reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000025', '00000000-0000-0000-0000-000000000001',
   'legal.savedview.create', 'Create saved view', 'Save a named filter/sort view for a list surface.',
   'autonomous', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000026', '00000000-0000-0000-0000-000000000001',
   'legal.savedview.update', 'Update saved view', 'Update a saved view (name or filter/sort config).',
   'autonomous', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;
