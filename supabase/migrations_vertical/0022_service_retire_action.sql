-- =============================================================================
-- Vertical migration 0022: Retire a service offering (beta sprint Objective 12)
--
-- Today there is no way to remove a service offering: upsert seals-then-replaces,
-- and set_active only flips status while the row stays current (valid_to IS NULL).
-- legal.service.retire seals the current row WITHOUT a successor, so the service
-- leaves every listing (all service reads filter valid_to IS NULL) while its
-- history stays immutable. Used to clear leftover test-fixture service rows from
-- workflow_definition that the entity-only reseed never touched.
--
-- Definition only (configuration-as-data). Next free action id verified against
-- the live pilot DB (action_kind ≤ 0021). Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000022', '00000000-0000-0000-0000-000000000001',
   'legal.service.retire', 'Retire service offering', 'Seal a service offering with no successor version so it leaves all listings (history preserved).',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
