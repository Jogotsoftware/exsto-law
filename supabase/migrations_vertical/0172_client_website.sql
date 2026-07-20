-- =============================================================================
-- 0172 — WP B3: real client WEBSITE field (founder-approved CRM comp parity).
--
-- The binding comp (docs/design/legal-instruments/legal-instruments.dc.html)
-- shows a WEBSITE column on the CRM Clients list; the app currently shows a
-- Billing column there instead (a documented deviation the founder has now
-- reversed — Billing stays on the client detail page, unchanged). This
-- migration adds the storage: one text attribute, `client_website`, on the
-- `client` entity kind — same shape as every other single-value client
-- setting (client_name, client_billable_rate, client_billing_type,
-- portal_scheduling_billable). No new table, no new entity/relationship/
-- action kind — config-as-data (CLAUDE.md hard rule 8).
--
-- It also becomes a real, verified input to the Client Brief external-research
-- privacy guard (verticals/legal/src/api/briefResearchGuard.ts): the closed
-- PublicIdentifiers.website field was reserved pending exactly this attribute
-- existing. That guard is entirely application-level (no DB dependency) — this
-- migration only makes the field exist on the client entity kind; wiring the
-- extractor/handler/query layer to read and write it is the accompanying code
-- change, not this file.
--
-- Tenant-zero uses a fixed id (below); every OTHER existing tenant gets the
-- same attribute via a random-uuid loop guarded by NOT EXISTS, mirroring 0161
-- CLIENT-PORTAL-UI-1's "same kinds for EVERY OTHER existing tenant" shape
-- (portal_assistant_enabled on the `client` kind is the closest precedent:
-- a single new attribute on an existing, already-provisioned entity kind).
--
-- Id block: …1011-000000002120 (renumbered from …2100 — the Wave-1 sibling collision; 0170 keeps …2100. 0169 holds …2000-…2007,
-- the highest attribute-kind id on origin/main; verified free against every
-- migrations_vertical/*.sql and supabase/seed/*.sql id on this branch).
--
-- PLANNED, NOT APPLIED: this file is authored and reviewed in WP B3 but is not
-- run against prod as part of this PR (no `apply_migration` call, no local
-- `pnpm migrate:vertical` against prod). Number 0172 is RESERVED — siblings
-- 0170/0171 are owned by other in-flight parallel sessions and were verified
-- absent from both origin/main and this branch at authoring time.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── tenant-zero ────────────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT '00000000-0000-0000-1011-000000002120', '00000000-0000-0000-0000-000000000001',
       'client_website', 'Website',
       'The client''s own website (CRM comp parity — the Clients list WEBSITE column and an editable field on the client detail page). A plain text URL/domain, attorney-entered. Also the verified source for PublicIdentifiers.website in the Client Brief external-research privacy guard (briefResearchGuard.ts) — normalized/validated there, stored here as entered.',
       ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'client' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

-- ── same kind for EVERY OTHER existing tenant (0161 pattern) ────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT gen_random_uuid(), cl.tenant_id, 'client_website', 'Website',
       'The client''s own website (CRM comp parity — the Clients list WEBSITE column and an editable field on the client detail page). A plain text URL/domain, attorney-entered.',
       cl.id, 'text', false
FROM entity_kind_definition cl
WHERE cl.kind_name = 'client' AND cl.status = 'active'
  AND cl.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = cl.tenant_id AND a.kind_name = 'client_website'
  );
