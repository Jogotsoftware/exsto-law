-- =============================================================================
-- Vertical migration 0182: drop the NC-hardcoded "in NC" suffix from the
-- registered-agent-address intake field label (A1.2)
--
-- fieldLabelOf() resolves a field's client-facing label in this order:
-- label_i18n[lang] -> t('field.<id>.label') -> the config's own `label`. The
-- static i18n dict SHADOWS whatever an attorney sets on the field, so the
-- copy fix has three layers: the i18n dict (code, this PR), the seed
-- template file (verticals/legal/templates/intake-questionnaire-oa.json,
-- this PR), and this migration, which rewrites the LIVE config value so a
-- firm that already provisioned from the seed template sees the same fix
-- without a re-seed.
--
-- Config-as-data, not code (hard rule 8): the questionnaire field label is a
-- definition value living in workflow_definition.transitions.intake_schema,
-- not a literal in source. Direct UPDATE is allowed here only because this
-- is a seed/backfill migration (CLAUDE.md rule 9); in-app edits flow through
-- legal.service.upsert.
--
-- SURGICAL + idempotent, same shape as 0069_address_fields_autocomplete.sql:
-- rewrites only the "company" section's fields, flipping ONLY the
-- registered_agent_address field's label. Every other field, section, and
-- transitions key is preserved verbatim. Only the CURRENT active row
-- (valid_to IS NULL) is touched. Re-running is a no-op (sets the same
-- value). Scoped to tenant-zero (the seed/demo tenant, same scope as 0069) —
-- if a live tenant's own row has diverged from the seed template, verify at
-- execution and extend the WHERE clause to that tenant_id too.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

UPDATE workflow_definition wd
   SET transitions = jsonb_set(
     wd.transitions,
     '{intake_schema,sections}',
     (
       SELECT jsonb_agg(
         CASE
           WHEN section->>'id' = 'company'
           THEN jsonb_set(section, '{fields}', (
                  SELECT jsonb_agg(
                    CASE
                      WHEN field->>'id' = 'registered_agent_address'
                      THEN jsonb_set(field, '{label}', '"Registered agent address"'::jsonb)
                      ELSE field
                    END
                    ORDER BY fi.ord)
                  FROM jsonb_array_elements(section->'fields') WITH ORDINALITY AS fi(field, ord)
                ))
           ELSE section
         END
         ORDER BY si.ord)
       FROM jsonb_array_elements(wd.transitions->'intake_schema'->'sections')
              WITH ORDINALITY AS si(section, ord)
     )
   )
 WHERE wd.tenant_id = '00000000-0000-0000-0000-000000000001'
   AND wd.kind_name = 'nc_llc_single_member'
   AND wd.valid_to IS NULL
   AND wd.transitions->'intake_schema' IS NOT NULL;

SELECT public.sync_migration_history();
