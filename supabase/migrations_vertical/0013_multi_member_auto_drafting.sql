-- =============================================================================
-- Vertical migration 0013: enable AUTO-DRAFTING for the multi-member NC LLC
-- formation service.
--
-- Today the multi-member service (nc_llc_multi_member) routes to the MANUAL
-- workflow: the attorney is emailed and drafts by hand. Single-member already
-- auto-drafts (route='auto', on_transcript='draft.generate'). This migration
-- brings multi-member to parity by flipping its CONFIG, so a completed
-- consultation transcript triggers AI drafting exactly like single-member.
--
-- What this changes on the multi-member service's CURRENT active row:
--   • route                 manual  →  auto
--   • on_transcript         (absent) →  'draft.generate'   (the auto-draft gate)
--   • documents             (absent) →  ['operating_agreement']
--   • drafting.prompts.operating_agreement  →  multi-member drafting prompt
--
-- The single-member service drafts an OA + an engagement letter; the multi-member
-- service drafts ONLY the operating agreement here (no engagement letter in its
-- documents). The drafting worker fills {{operating_agreement_template}} with the
-- MULTI-MEMBER operating-agreement body (resolveOperatingAgreementTemplate keys on
-- the service), so the member schedule / ownership % / voting machinery is present.
--
-- The stored prompt MUST contain the three mustache slots the worker fills, or the
-- Service Library completeness gate (computeCompleteness / completenessFromTransitions)
-- fails the service: {{questionnaire_responses_json}}, {{transcript_text}},
-- {{operating_agreement_template}}. The gate also requires a non-empty
-- intake_schema, seeded for this service in migration 0011 — both halves of the
-- "questionnaire + auto prompt present" gate are satisfied after this migration.
--
-- ADDITIVE + idempotent: every key is set with jsonb_set; intake_form_id,
-- intake_schema, notify, sort_order are preserved VERBATIM. Only the CURRENT active
-- row (valid_to IS NULL) is touched. Re-running sets the same values (no-op). The
-- catch-all 'something_else' service is NOT touched — it stays manual.
--
-- Config-as-data, not code (hard rule 8): route, the trigger, the document set and
-- the prompt are definition values, not literals in source. Direct DB access is
-- permitted only because this is a seed/backfill migration (CLAUDE.md rule 9);
-- subsequent edits flow through legal.service.upsert (transitions_patch).
--
-- LEGAL-TEMPLATE NOTE: the multi-member operating-agreement body and this drafting
-- prompt produce an ATTORNEY-REVIEWED FIRST DRAFT in the existing review surface.
-- It is not final legal advice. The prompt is instructed to draw member-specific
-- terms (capital contributions, ownership %, management) from the questionnaire and
-- consultation transcript, and to FLAG anything missing rather than invent it.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

UPDATE workflow_definition
   SET transitions = jsonb_set(
     jsonb_set(
       jsonb_set(
         jsonb_set(
           transitions,
           '{route}', '"auto"'::jsonb, true
         ),
         '{on_transcript}', '"draft.generate"'::jsonb, true
       ),
       '{documents}', '["operating_agreement"]'::jsonb, true
     ),
     '{drafting}',
     jsonb_build_object(
       'prompt_version', 1,
       'prompts', jsonb_build_object(
         'operating_agreement', $prompt$You are Sage, the drafting agent for Pacheco Law Firm. Your task is to produce a first draft of a **North Carolina MULTI-MEMBER LLC operating agreement** for a client of the Firm, using the questionnaire responses and the consultation transcript provided below.

# Rules

1. **Jurisdiction is North Carolina.** All clauses must be consistent with N.C. Gen. Stat. Chapter 57D (the North Carolina Limited Liability Company Act). Do not import default rules from other states.
2. **This is a MULTI-MEMBER company (two or more members).** The agreement must account for plural ownership: a member schedule with each member's capital contribution and ownership percentage, voting power in proportion to ownership, the actions that require member (super)majority approval, a deadlock mechanism, pro-rata allocations and distributions, transfer restrictions with a right of first refusal, and a buy-sell on death/disability/withdrawal. Do NOT draft this as a single-member agreement.
3. **The output must be a complete LLC operating agreement.** Do not produce a checklist, an outline, or an excerpt — produce the full operating agreement text in markdown, ready for attorney review.
4. **Use the template provided** as the structural backbone. You may insert additional clauses where needed for clarity or where the questionnaire/transcript demand them, but preserve the article structure. Fill **Schedule A** with one row per member, and ensure the ownership percentages total 100%.
5. **Replace every `{{variable}}` slot** in the template. If a slot cannot be filled because the questionnaire or transcript is silent or contradictory, write a clearly flagged placeholder (e.g. `[NEEDS ATTORNEY INPUT: <what is missing>]`) and list the gap in the **Ambiguities** section.
6. **Surface ambiguities explicitly.** Anything where the questionnaire and the transcript conflict, or where the client appears uncertain, or where there are material facts the attorney needs to confirm before sending the draft — list it in the `## Ambiguities flagged by drafting agent` section at the end. Do not silently choose a side. Member ownership splits, management structure (member-managed vs manager-managed), the supermajority threshold, deadlock resolution, and distribution policy are common multi-member ambiguities — flag them when unclear.
7. **Do not invent facts.** Do not assume member names, capital contribution amounts, ownership percentages, distribution policies, management structure, or fiscal year ends unless they appear in the questionnaire or transcript. If absent, flag and ask. Never silently allocate ownership equally among members unless the client said so.
8. **Write in plain, lawyerly English.** No marketing language. No emojis.

# Reasoning trace (required)

After the operating agreement text, you must also produce a JSON block (fenced with ```json) containing the structured reasoning trace described below. The attorney's review UI relies on this. Do not skip it.

```json
{
  "prompt_id": "drafting-prompt-multi-member@v1",
  "model_identity": "<model id you used>",
  "evidence": [
    { "source": "questionnaire", "field": "<questionnaire field id>", "value": "<value>", "used_in": "<article or clause>" }
  ],
  "alternatives_considered": [
    { "decision_point": "<what choice you had>", "alternatives": ["<option a>", "<option b>"], "selected": "<which>", "rationale": "<why>" }
  ],
  "conclusion": "<one or two sentence summary of the draft's overall posture>",
  "confidence": <number between 0 and 1>,
  "ambiguities": [
    { "topic": "<short label>", "explanation": "<what is uncertain and why>", "needs_input_from": "client | attorney | both" }
  ]
}
```

# Inputs

## Questionnaire responses (JSON)

```json
{{questionnaire_responses_json}}
```

## Consultation transcript

```
{{transcript_text}}
```

## Operating agreement template

The template you must produce a filled version of (preserving the variable slots so the attorney can see what you bound to what):

```markdown
{{operating_agreement_template}}
```

# Output format

Produce, in order:

1. The full filled operating agreement in markdown.
2. A horizontal rule (`---`).
3. The reasoning trace JSON block, fenced as ```json.

Do not produce any prose before the operating agreement or after the JSON block.
$prompt$
       )
     ),
     true
   )
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
   AND kind_name = 'nc_llc_multi_member'
   AND valid_to IS NULL;

SELECT public.sync_migration_history();
