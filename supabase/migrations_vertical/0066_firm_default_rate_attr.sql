-- =============================================================================
-- Vertical migration 0066: Contract K — firm_default_hourly_rate attribute (fix)
--
-- 0065 defined firm_settings + the legal.firm.set_default_rate action, but its
-- attribute_kind id (…1011-000000000501) collided with a pre-existing kind
-- (email_signature_enabled, the …500 mail-settings block), so ON CONFLICT (id)
-- DO NOTHING silently skipped the attribute row. Forward-only discipline: 0065
-- is already applied + recorded, so this is a NEW migration with a verified-free
-- id (…1011-0000000005a1) rather than an edit to 0065.
--
-- Money discipline (ADR 0044): value_type 'money' — a DECIMAL STRING. Attaches to
-- the firm_settings singleton entity (…1010-000000000501). Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-0000000005a1', '00000000-0000-0000-0000-000000000001',
   'firm_default_hourly_rate', 'Firm default hourly rate',
   'The firm-wide fallback hourly rate, a decimal string (ADR 0044). Contract K resolves a client''s rate to client_billable_rate, falling back to this when the client has none. Effective-dated by valid_from.',
   '00000000-0000-0000-1010-000000000501', 'money', false)
ON CONFLICT (id) DO NOTHING;
