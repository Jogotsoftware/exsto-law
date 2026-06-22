-- =============================================================================
-- Vertical migration 0086: engagement status on clients and matters (groundwork)
--
-- Registers `engagement_status` (enum prospective|non_retained|retained|former),
-- mirroring the existing `company_engagement_status` (migration 0067) but applied
-- to BOTH the client and the matter entity kinds. Because attribute writes resolve
-- a kind by name alone (on_entity_kind_id is descriptive, not enforced), one
-- UNSCOPED row (on_entity_kind_id = NULL, like `due_date`) cleanly serves both —
-- a single honest definition rather than two near-duplicates.
--
-- Default semantics: ABSENCE = non-retained. Effective-dating rides the attribute
-- table's existing valid_from / valid_to (no extra columns). Read by NOTHING in
-- this task — pure groundwork. Trust/IOLTA/retainer accounting is explicitly
-- deferred (out of scope). DEFINITION ONLY.
--
-- Id: attribute 1011-…0810 (0800 block, verified free on prod and clear of the
-- parallel migrations). Configuration-as-data; idempotent; no schema change.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii, validation) VALUES
  ('00000000-0000-0000-1011-000000000810', '00000000-0000-0000-0000-000000000001',
   'engagement_status', 'Engagement status',
   'prospective | non_retained | retained | former — applies to a client or a matter. Absence means non-retained. Effective-dated via valid_from/valid_to. Groundwork only; retainer/trust accounting is deferred.',
   NULL, 'enum', false,
   '{"enum":["prospective","non_retained","retained","former"]}')
ON CONFLICT (id) DO NOTHING;
