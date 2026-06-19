-- =============================================================================
-- Vertical migration 0069: render the OA intake address fields as autocomplete
--
-- The single-member operating-agreement intake (nc_llc_single_member) carried
-- two free-form address fields — registered_agent_address and
-- principal_office_address — that rendered as multi-line textareas (later
-- single-line text). Both are real postal addresses, so they should use the
-- SAME field the member-address slot already uses: the Google-Places-backed
-- "address_autocomplete" widget (compact single line + address autofill +
-- structured StructuredAddress value). This flips their type accordingly.
--
-- Config-as-data, not code (hard rule 8): the questionnaire field type is a
-- definition value living in workflow_definition.transitions.intake_schema, not
-- a literal in source. Direct UPDATE is allowed here only because this is a
-- seed/backfill migration (CLAUDE.md rule 9); in-app edits flow through
-- legal.service.upsert.
--
-- SURGICAL + idempotent: rewrites only the "company" section's fields, flipping
-- ONLY the two address fields (matched by id, order-independent) to
-- address_autocomplete. Every other field, section, and transitions key is
-- preserved verbatim. Only the CURRENT active row (valid_to IS NULL) is touched.
-- Re-running is a no-op (sets the same value). Existing matters' stored answers
-- are untouched — this changes the form schema, not captured data; the attorney
-- view and drafting paths already tolerate both string and structured-address
-- shapes.
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
                      WHEN field->>'id' IN ('registered_agent_address', 'principal_office_address')
                      THEN jsonb_set(field, '{type}', '"address_autocomplete"'::jsonb)
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
