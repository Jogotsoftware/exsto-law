-- =============================================================================
-- Vertical migration 0181: B1.1 intake-edge fix + B1.2 merge-token config fix
--
-- PLANNED — NOT APPLIED to any environment (dev or prod) by this PR. The
-- orchestrator session applies it after review, per the rebase-train protocol
-- (ui-fixes-for-exsto-lexical-starlight.md). Data-only (hard rule 8): no new
-- kinds, no schema change — jsonb_set/jsonb-rebuild patches to the CURRENT
-- active row(s) of workflow_definition. Every block is defensive: it inspects
-- what is actually there before writing, and RAISE NOTICEs what it did or why
-- it skipped, so applying this is self-diagnosing rather than a blind write.
--
-- ── B1.1 (item 7): the intake-edge structural no-op ─────────────────────────
-- Code fix (this PR, lifecycle/authored.ts + lifecycle/derive.ts) changes the
-- TEMPLATE a service's lifecycle is authored FROM going forward. It does NOT
-- touch any workflow_definition.states row already written to the DB — states
-- is a stored jsonb snapshot (binding.ts resolveBoundWorkflowById reads it by
-- fixed row id), not re-derived from the TS constant at read time. So a
-- service that was already authored with the old, structurally-broken entry
-- edge — `{gate:'client', via:'booking.create'}`, which signalEvent
-- (executor.ts) can never match because it only matches system/automatic
-- `on:` edges — needs its STORED states patched too, or matters bound to that
-- exact row stay stuck regardless of the code fix landing.
--
-- Scoped to the two known services carrying this exact authored shape (never
-- a blind sweep of every tenant's every workflow_definition row): tenant-zero
-- nc_single_member_llc_formation (authored via demo/author-smllc-workflow.ts,
-- NC_SMLLC_AUTHORED) and Pacheco Law's single_member_llc_operating_agreement
-- (ae5530a1-05c7-4241-a38e-79bd186c1bbb, FIRM-PROVISIONING-1/2 replay — its
-- `states` blob was copied structurally from a dev-tenant sibling service, so
-- it plausibly carries the same shape under different stage keys). The patch
-- is SHAPE-matched (entry stage, action.kind='view_intake', an outgoing edge
-- with gate='client' AND via='booking.create') rather than key-name-matched,
-- so it is correct however the two services' stage keys ended up named, and a
-- complete no-op (with a NOTICE saying so) if a row does not carry that shape
-- — e.g. because it resolves via the derive.ts fallback (empty states) rather
-- than an authored graph, or was already hand-fixed via the Service Builder.
--
-- After this applies, a matter already bound to the patched row unsticks on
-- its own next signal — no repin needed for THAT row. `legal.matter.
-- repin_workflow` (#416) remains the fallback for any matter pinned to an
-- OLDER version of one of these services (a version this migration does not
-- touch, since only the CURRENT active row is patched) — see
-- demo/unstick-pacheco-matter.ts and demo/stranded-intake-matters.ts (this
-- PR) for the per-matter recipe and the read-only count.
--
-- ── B1.2 (merge tokens): Pacheco's OA service ────────────────────────────────
-- Pacheco's single_member_llc_operating_agreement runs `ai_draft` by default
-- (no generation_mode in transitions) — the AI drafting prompt's "do not
-- invent facts" rule then leaves an unmapped `{{token}}` verbatim in the
-- persisted draft instead of filling it. Three fixes, modeled on the correct
-- tenant-zero shape (demo/nc-smllc-provision.ts): (1) generation_mode →
-- template_merge, service-level AND per-document (generateDraft.ts
-- resolveGenerationMode checks per-document first); (2) the OA template's
-- `{{effective_date}}` token is retokenized to `{{expected_formation_date}}`
-- — NOT an intake-schema rename. templateMerge.ts's buildMergeData treats
-- effective_date as a CURATED slot that ALWAYS resolves to today's date
-- (`longDate(new Date().toISOString())` at generation time, never an intake
-- answer — unlike letter_date/client_name, effective_date has no "answer
-- wins" fallback), so renaming the INTAKE field instead would still get
-- clobbered by the curated value; renaming the TEMPLATE's token is the only
-- config-only change that actually binds the client's chosen date. (3)
-- company_name binding is DIAGNOSED, not blindly rewritten: buildMergeData
-- resolves company_name from intake answers under one of exactly
-- {company_name, proposed_company_name, llc_name} (templateMerge.ts pick()).
-- This block checks whether Pacheco's intake_schema already has a field id in
-- that set and RAISES NOTICE either way — including the actual field ids
-- present when it does not — rather than guessing which field is "the" LLC
-- name and silently retokenizing a legal document's company-name slot.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── B1.1: patch the stage-1 entry edge, shape-matched, on the two known rows ──
DO $$
DECLARE
  rec RECORD;
  new_states jsonb;
BEGIN
  FOR rec IN
    SELECT id, tenant_id, kind_name, states
      FROM workflow_definition
     WHERE valid_to IS NULL
       AND (
         (tenant_id = '00000000-0000-0000-0000-000000000001'
            AND kind_name = 'nc_single_member_llc_formation')
         OR (tenant_id = 'ae5530a1-05c7-4241-a38e-79bd186c1bbb'
            AND kind_name = 'single_member_llc_operating_agreement')
       )
  LOOP
    IF rec.states IS NULL OR jsonb_typeof(rec.states) <> 'array' OR jsonb_array_length(rec.states) = 0 THEN
      RAISE NOTICE 'B1.1: tenant % kind % has empty/no states (resolves via derive.ts fallback) — nothing to patch', rec.tenant_id, rec.kind_name;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(
             CASE
               WHEN (stage -> 'action' ->> 'kind') = 'view_intake'
                    AND COALESCE((stage ->> 'entry')::boolean, false)
               THEN jsonb_set(
                      stage,
                      '{advances_to}',
                      (
                        SELECT jsonb_agg(
                                 CASE
                                   WHEN edge ->> 'gate' = 'client' AND edge ->> 'via' = 'booking.create'
                                   THEN jsonb_build_object(
                                          'to', edge ->> 'to',
                                          'gate', 'system',
                                          'on', 'intake.completed'
                                        )
                                   ELSE edge
                                 END
                               )
                          FROM jsonb_array_elements(stage -> 'advances_to') AS edge
                      )
                    )
               ELSE stage
             END
           )
      INTO new_states
      FROM jsonb_array_elements(rec.states) AS stage;

    IF new_states IS DISTINCT FROM rec.states THEN
      UPDATE workflow_definition SET states = new_states WHERE id = rec.id;
      RAISE NOTICE 'B1.1: patched the view_intake entry edge (client/booking.create → system/intake.completed) for tenant % kind %', rec.tenant_id, rec.kind_name;
    ELSE
      RAISE NOTICE 'B1.1: no client/booking.create entry edge found for tenant % kind % — already fixed, differently authored, or differently shaped; skipped', rec.tenant_id, rec.kind_name;
    END IF;
  END LOOP;
END $$;

-- ── B1.2: Pacheco's OA service — generation_mode, effective_date retokenize,
--          company_name diagnostic ────────────────────────────────────────────
DO $$
DECLARE
  v_tenant uuid := 'ae5530a1-05c7-4241-a38e-79bd186c1bbb';
  v_kind text := 'single_member_llc_operating_agreement';
  v_id uuid;
  cur_transitions jsonb;
  new_transitions jsonb;
  tmpl text;
  intake jsonb;
  has_company_alias boolean;
  present_field_ids jsonb;
BEGIN
  SELECT id, transitions INTO v_id, cur_transitions
    FROM workflow_definition
   WHERE tenant_id = v_tenant AND kind_name = v_kind AND valid_to IS NULL
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE 'B1.2: no active workflow_definition row for tenant % kind % — skipped', v_tenant, v_kind;
    RETURN;
  END IF;

  new_transitions := cur_transitions;

  -- (1) generation_mode: template_merge, service-level AND per-document.
  new_transitions := new_transitions || jsonb_build_object('generation_mode', 'template_merge');
  new_transitions := jsonb_set(
    new_transitions,
    '{document_generation}',
    COALESCE(new_transitions -> 'document_generation', '{}'::jsonb)
      || jsonb_build_object('operating_agreement', jsonb_build_object('generation_mode', 'template_merge')),
    true
  );
  RAISE NOTICE 'B1.2: generation_mode → template_merge (service-level + document_generation.operating_agreement)';

  -- (2) retokenize {{effective_date}} → {{expected_formation_date}} in the OA
  -- template body (config-only; see header for why the intake side is not
  -- the fix). Defensive: only touches the body if the literal token is there.
  tmpl := new_transitions -> 'document_templates' -> 'templates' ->> 'operating_agreement';
  IF tmpl IS NULL THEN
    RAISE NOTICE 'B1.2: no operating_agreement body at transitions.document_templates.templates.operating_agreement — could not check/retokenize {{effective_date}}; verify by hand';
  ELSIF tmpl LIKE '%{{effective_date}}%' THEN
    tmpl := replace(tmpl, '{{effective_date}}', '{{expected_formation_date}}');
    new_transitions := jsonb_set(
      new_transitions,
      '{document_templates,templates,operating_agreement}',
      to_jsonb(tmpl)
    );
    RAISE NOTICE 'B1.2: retokenized {{effective_date}} → {{expected_formation_date}} in the OA template body';
  ELSE
    RAISE NOTICE 'B1.2: OA template body has no literal {{effective_date}} token — nothing to retokenize';
  END IF;

  -- (3) company_name binding — diagnostic only, never a guessed rewrite.
  intake := new_transitions -> 'intake_schema';
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(intake -> 'sections', '[]'::jsonb)) sec,
           jsonb_array_elements(COALESCE(sec -> 'fields', '[]'::jsonb)) fld
     WHERE fld ->> 'id' IN ('company_name', 'proposed_company_name', 'llc_name')
  ) INTO has_company_alias;

  IF has_company_alias THEN
    RAISE NOTICE 'B1.2: company_name binding OK — intake_schema already has a field id in {company_name, proposed_company_name, llc_name}';
  ELSE
    SELECT jsonb_agg(fld ->> 'id')
      INTO present_field_ids
      FROM jsonb_array_elements(COALESCE(intake -> 'sections', '[]'::jsonb)) sec,
           jsonb_array_elements(COALESCE(sec -> 'fields', '[]'::jsonb)) fld;
    RAISE NOTICE 'B1.2: company_name binding NOT CONFIRMED — no intake_schema field id matches {company_name, proposed_company_name, llc_name}. Field ids present: %. Not rewritten here (avoid guessing on a legal-document token) — fix by hand via the Service Builder (rename the LLC-name field''s id to company_name), or confirm the alias and follow up in a later migration.', present_field_ids;
  END IF;

  UPDATE workflow_definition SET transitions = new_transitions WHERE id = v_id;
  RAISE NOTICE 'B1.2: transitions patched for tenant % kind %', v_tenant, v_kind;
END $$;

SELECT public.sync_migration_history();
