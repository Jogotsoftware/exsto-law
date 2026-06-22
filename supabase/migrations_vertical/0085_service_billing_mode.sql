-- =============================================================================
-- Vertical migration 0085: service billing-mode vocabulary (groundwork)
--
-- Registers the `service_billing_mode` attribute kind (enum fixed|hourly|hybrid)
-- as forward-looking groundwork for service-level billing. A "service" is a
-- workflow_definition row (not an entity), and its fee already lives as
-- config-as-data in transitions.cost {type:'fixed'|'hourly'} (migrations 0071 /
-- 0080) — so this kind is registered UNSCOPED (on_entity_kind_id = NULL, the same
-- way `due_date` is) and is read by NOTHING yet. The NC SMLLC service marks itself
-- fixed via transitions.billing_mode = 'fixed'; the actual fixed-fee AMOUNT is set
-- later by the firm. Rate-resolution logic is explicitly out of scope here
-- (Contract K / S4). DEFINITION ONLY.
--
-- Id: attribute 1011-…0820 (0800 block, verified free on prod and clear of the
-- parallel migrations). Configuration-as-data; idempotent; no schema change.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii, validation) VALUES
  ('00000000-0000-0000-1011-000000000820', '00000000-0000-0000-0000-000000000001',
   'service_billing_mode', 'Service billing mode',
   'fixed | hourly | hybrid — how a service is billed. Groundwork: a service is a workflow_definition (not an entity), so this is unscoped and read by nothing yet; the fee itself lives in transitions.cost. Hourly/hybrid rate resolution is deferred (Contract K / S4).',
   NULL, 'enum', false,
   '{"enum":["fixed","hourly","hybrid"]}')
ON CONFLICT (id) DO NOTHING;
