-- 0166_dev_tenant_reslug.sql
-- FIRM-PROVISIONING-1: tenant 00000000-0000-0000-0000-000000000001 ("Pacheco Law Firm",
-- slug 'pacheco-law') is now officially the DEV tenant (all data in it is fake). Rename
-- it to "Dev Firm" / slug 'dev-firm' so the REAL Pacheco Law tenant can own the 'pacheco'
-- public slug and NO pacheco-flavored public URL resolves to the dev tenant.
--
-- The real Pacheco Law tenant is provisioned imperatively through the recorded
-- private.cp_bootstrap_tenant pathway (see verticals/legal/demo/provision-pacheco.ts),
-- NOT in this migration: it is prod-only data and depends on a platform-admin actor that
-- does not exist on a fresh CI/seed DB. This migration touches ONLY tenant zero, so it is
-- CI/seed-safe and idempotent.
UPDATE public.tenant
   SET name = 'Dev Firm', public_slug = 'dev-firm'
 WHERE id = '00000000-0000-0000-0000-000000000001';
