-- =============================================================================
-- Vertical migration 0096: module action kinds (all tenants) + master catalog
--
-- (1) Seed legal.module.define/enable/disable into EVERY existing tenant so the
--     control plane can submitAction these in any target tenant. Seeding into
--     tenant zero (the clone source for cp_bootstrap_tenant) means future tenants
--     inherit them automatically.
-- (2) Seed the MASTER module catalog into the platform tenant (the admin reads it
--     in the platform context; ui_areas gate the firm app nav). `requires` is left
--     minimal for the legal modules because their kinds already exist in every
--     tenant (cloned from tenant zero) — enablement is a GATE here; promotion
--     (0098) is what installs genuinely-new config.
--
-- Idempotent: per-tenant NOT EXISTS guard on action kinds; ON CONFLICT on the
-- catalog unique (tenant_id, module_key). Number 0096 = next after 0095.
-- =============================================================================

-- (1) Module action kinds into every tenant.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.tenant_id', r.id::text, true);
    INSERT INTO action_kind_definition
      (id, tenant_id, kind_name, display_name, description,
       default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace)
    SELECT gen_random_uuid(), r.id, k.kind_name, k.display_name, k.description,
           'autonomous', 'reversible_with_state_decay', k.reverse, false
    FROM (VALUES
      ('legal.module.define',  'Define module',
        'Create or update a module catalog entry (a feature bundle).', NULL),
      ('legal.module.enable',  'Enable module',
        'Enable a feature module for a tenant: install its manifest and record enablement.',
        'legal.module.disable'),
      ('legal.module.disable', 'Disable module',
        'Disable a feature module for a tenant: deactivate its scopes and hide its UI (data is kept).',
        'legal.module.enable')
    ) AS k(kind_name, display_name, description, reverse)
    WHERE NOT EXISTS (
      SELECT 1 FROM action_kind_definition akd
      WHERE akd.tenant_id = r.id AND akd.kind_name = k.kind_name
        AND (akd.valid_to IS NULL OR akd.valid_to > now())
    );
  END LOOP;
END $$;

-- (2) Master catalog into the platform tenant.
SELECT set_config('app.tenant_id', '00000000-0000-0000-00FF-000000000001', false);

INSERT INTO module_definition (id, tenant_id, module_key, display_name, description, ui_areas) VALUES
  ('00000000-0000-0000-00F5-000000000001', '00000000-0000-0000-00FF-000000000001',
   'matters', 'Matters', 'Core matter management and document review.',
   '["/attorney/matters","/attorney/review"]'::jsonb),
  ('00000000-0000-0000-00F5-000000000002', '00000000-0000-0000-00FF-000000000001',
   'calendar', 'Calendar', 'Consultation booking and the firm calendar.',
   '["/attorney/calendar"]'::jsonb),
  ('00000000-0000-0000-00F5-000000000003', '00000000-0000-0000-00FF-000000000001',
   'billing', 'Billing & Invoicing', 'Time/expense capture, invoices, and payments.',
   '["/attorney/billing"]'::jsonb),
  ('00000000-0000-0000-00F5-000000000004', '00000000-0000-0000-00FF-000000000001',
   'crm', 'CRM', 'Contacts, companies, and relationships.',
   '["/attorney/crm"]'::jsonb),
  ('00000000-0000-0000-00F5-000000000005', '00000000-0000-0000-00FF-000000000001',
   'documents', 'Documents & Templates', 'Document templates, questionnaires, and service definitions.',
   '["/attorney/templates","/attorney/questionnaires","/attorney/questions","/attorney/services"]'::jsonb),
  ('00000000-0000-0000-00F5-000000000006', '00000000-0000-0000-00FF-000000000001',
   'client-portal', 'Client Portal', 'The client portal: messaging, invoices, and cost-gated requests.',
   '["/attorney/requests"]'::jsonb),
  ('00000000-0000-0000-00F5-000000000007', '00000000-0000-0000-00FF-000000000001',
   'e-sign', 'E-Signature', 'Send documents for signature and track envelopes.',
   '[]'::jsonb)
ON CONFLICT (tenant_id, module_key) WHERE valid_to IS NULL DO NOTHING;

SELECT public.sync_migration_history();
