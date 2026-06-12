-- =============================================================================
-- Vertical migration 0011: seed each service's intake questionnaire into config
--
-- PR2 (Questionnaire Editor) makes a service's intake form editable in-app. The
-- form now lives as config-as-data in transitions.intake_schema, resolved by the
-- API ahead of the Phase-0 repo file (verticals/legal/templates/intake-*.json).
-- This migration backfills that key for the three seeded services with the EXACT
-- contents of the matching repo file, so the public booking page renders the same
-- form before and after the cutover.
--
-- ADDITIVE + idempotent: jsonb_set only ADDS the intake_schema key; route,
-- intake_form_id, documents, on_transcript, notify and sort_order are preserved
-- VERBATIM. Only the CURRENT active row of each service (valid_to IS NULL) is
-- touched. Re-running overwrites intake_schema with the same value (no-op).
--
-- Config-as-data, not code (hard rule 8): the questionnaire is a definition value,
-- not a literal in source. The action layer is not used here only because this is
-- a seed/backfill migration script (allowed direct DB access — CLAUDE.md rule 9);
-- subsequent edits flow through legal.service.upsert.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- nc_llc_single_member  ←  intake-questionnaire-oa.json
UPDATE workflow_definition
   SET transitions = jsonb_set(
     transitions,
     '{intake_schema}',
     $json$
{
  "id": "intake-questionnaire-oa",
  "version": 1,
  "title": "North Carolina LLC operating agreement intake",
  "description": "Pre-consultation intake for a North Carolina limited liability company operating agreement. The attorney reviews these answers before the consultation and the drafting agent uses them to assemble a first draft.",
  "jurisdiction": "NC",
  "sections": [
    {
      "id": "company",
      "title": "About the company",
      "fields": [
        { "id": "company_name", "label": "Proposed LLC name", "type": "text", "required": true },
        { "id": "company_purpose", "label": "Purpose of the LLC (one sentence)", "type": "textarea", "required": true },
        { "id": "registered_agent_name", "label": "Registered agent name", "type": "text", "required": true },
        { "id": "registered_agent_address", "label": "Registered agent address in NC", "type": "textarea", "required": true },
        { "id": "principal_office_address", "label": "Principal office address", "type": "textarea", "required": true },
        { "id": "expected_formation_date", "label": "Expected formation date", "type": "date", "required": false }
      ]
    },
    {
      "id": "members",
      "title": "Members and ownership",
      "fields": [
        {
          "id": "members",
          "label": "Members",
          "type": "members_repeater",
          "required": true,
          "minItems": 1,
          "memberFields": [
            { "id": "name", "label": "Full legal name", "type": "text", "required": true },
            { "id": "address", "label": "Address", "type": "textarea", "required": true },
            { "id": "capital_contribution", "label": "Capital contribution (USD)", "type": "number", "required": true },
            { "id": "ownership_percentage", "label": "Ownership percentage", "type": "number", "required": true },
            { "id": "is_manager", "label": "Will also act as manager?", "type": "boolean", "required": true }
          ]
        },
        { "id": "management_structure", "label": "Management structure", "type": "select", "required": true, "options": ["member_managed", "manager_managed"] }
      ]
    },
    {
      "id": "operations",
      "title": "Operations and finances",
      "fields": [
        { "id": "fiscal_year_end", "label": "Fiscal year end (MM-DD)", "type": "text", "required": true },
        { "id": "distribution_policy", "label": "Distribution policy", "type": "textarea", "required": true, "help": "How profits and losses are allocated and when distributions are made." },
        { "id": "transfer_restrictions", "label": "Transfer restrictions", "type": "textarea", "required": false, "help": "Any restrictions on transferring membership interests (right of first refusal, etc.)." },
        { "id": "dissolution_triggers", "label": "Dissolution triggers", "type": "textarea", "required": false }
      ]
    },
    {
      "id": "engagement",
      "title": "Engagement terms",
      "fields": [
        { "id": "fee_structure", "label": "Fee structure", "type": "select", "required": true, "options": ["flat_fee", "hourly", "hybrid"] },
        { "id": "fee_amount", "label": "Fee amount (USD)", "type": "number", "required": true },
        { "id": "scope_notes", "label": "Scope notes (anything outside standard OA work?)", "type": "textarea", "required": false }
      ]
    }
  ]
}
$json$::jsonb,
     true
   )
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
   AND kind_name = 'nc_llc_single_member'
   AND valid_to IS NULL;

-- nc_llc_multi_member  ←  intake-nc-llc-multi-member.json
UPDATE workflow_definition
   SET transitions = jsonb_set(
     transitions,
     '{intake_schema}',
     $json$
{
  "id": "nc-llc-multi-member-v1",
  "version": 1,
  "title": "North Carolina multi-member LLC intake",
  "description": "Short pre-consultation intake for a multi-member North Carolina LLC formation. Juan Carlos reviews these answers before your consultation and drafts your documents after it.",
  "jurisdiction": "NC",
  "sections": [
    {
      "id": "company",
      "title": "About the business",
      "fields": [
        { "id": "company_name", "label": "Proposed LLC name", "type": "text", "required": true },
        { "id": "business_description", "label": "What will the business do?", "type": "textarea", "required": true }
      ]
    },
    {
      "id": "members",
      "title": "Members",
      "fields": [
        { "id": "member_count", "label": "How many members (owners) will the LLC have?", "type": "text", "required": true },
        {
          "id": "members",
          "label": "Members",
          "type": "repeater",
          "required": true,
          "minItems": 2,
          "memberFields": [
            { "id": "member_name", "label": "Full name", "type": "text", "required": true },
            { "id": "member_email", "label": "Email", "type": "text", "required": true },
            { "id": "member_phone", "label": "Phone", "type": "text" }
          ]
        }
      ]
    },
    {
      "id": "timeline",
      "title": "Timeline",
      "fields": [
        { "id": "anticipated_timeline", "label": "When do you want the LLC formed?", "type": "select", "required": true, "options": ["As soon as possible", "Within 30 days", "1–3 months", "Just exploring"] },
        { "id": "anything_else", "label": "Anything else the attorney should know?", "type": "textarea" }
      ]
    }
  ]
}
$json$::jsonb,
     true
   )
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
   AND kind_name = 'nc_llc_multi_member'
   AND valid_to IS NULL;

-- something_else  ←  intake-something-else.json
UPDATE workflow_definition
   SET transitions = jsonb_set(
     transitions,
     '{intake_schema}',
     $json$
{
  "id": "something-else-v1",
  "version": 1,
  "title": "Tell us about your matter",
  "description": "Describe what you need help with. Juan Carlos reviews this before your consultation.",
  "jurisdiction": "NC",
  "sections": [
    {
      "id": "matter",
      "title": "Your matter",
      "fields": [
        { "id": "matter_description", "label": "Tell us about your matter", "type": "textarea", "required": true, "help": "A few sentences is plenty — what's going on, and what outcome are you hoping for?" },
        { "id": "anticipated_timeline", "label": "How urgent is this?", "type": "select", "options": ["Urgent — days matter", "This month", "No rush"] }
      ]
    }
  ]
}
$json$::jsonb,
     true
   )
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
   AND kind_name = 'something_else'
   AND valid_to IS NULL;

SELECT public.sync_migration_history();
