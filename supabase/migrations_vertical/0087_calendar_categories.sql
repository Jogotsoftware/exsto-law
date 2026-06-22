-- =============================================================================
-- Vertical migration 0087: calendar categories / call types (color-coding)
-- (Renumbered 0083→0087: 0083 taken by skill_library on main; 0084-0086 taken by
--  the NC-SMLLC service migrations in the prod ledger. Id block 1011-708 /
--  1013-705,706 verified free on prod.)
--
-- Beta feedback: the attorney wants to color-code calendar events by call type
-- and configure the categories themselves. Two pieces, both schema-as-data:
--   1) The firm's CATEGORY PALETTE — a configurable list of {key,label,color} —
--      lives on a SINGLETON workflow_definition row (kind_name
--      'firm.calendar_categories'), written through legal.calendar.categories.update
--      (seal-and-insert + configuration_change audit, exactly like
--      firm.booking_rules / 0059). No row is seeded; reads default to a built-in
--      starter palette until the firm saves one (the handler writes version 1).
--   2) A booking's chosen category is a substrate fact on the matter: the
--      `consultation_category` attribute (value = a palette key), written ONLY
--      through the action layer via legal.booking.categorize.
--
-- Data-only / additive / idempotent (ON CONFLICT DO NOTHING). Ids verified free
-- on prod AND clear of the parallel billing (0080/0081) and document-upload
-- (0082) branches: attribute 1011-…708, actions 1013-…705/…706.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- A booking's category key (one of the firm palette keys), stored on the matter.
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000708', '00000000-0000-0000-0000-000000000001',
   'consultation_category', 'Consultation category',
   'The attorney-chosen call-type/category key for this matter''s consultation (one of the firm.calendar_categories palette keys).',
   '00000000-0000-0000-1010-000000000001', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- Categorize a booking: sets/changes the matter's consultation_category.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000705', '00000000-0000-0000-0000-000000000001',
   'legal.booking.categorize', 'Categorize a booking',
   'Set the call-type category on a matter''s consultation (writes the consultation_category attribute).',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- Update the firm's configurable category palette (the singleton
-- firm.calendar_categories workflow_definition; seal-and-insert like booking rules).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000706', '00000000-0000-0000-0000-000000000001',
   'legal.calendar.categories.update', 'Update calendar categories',
   'Set (or change) the firm''s configurable calendar category palette ({key,label,color}[]) on the singleton firm.calendar_categories workflow_definition; a new version supersedes the prior, audited via configuration_change.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
