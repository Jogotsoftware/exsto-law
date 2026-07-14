---
slug: firm-admin.author-questionnaire
name: Author an Intake Questionnaire
practice_area: firm-admin
description: Build a service's intake questionnaire FROM the document variables — each {{token}} the templates need becomes one field whose id binds the template by name — using only the closed field-type whitelist, sensible sections, and the humane-intake flags.
when_to_use: Applied by firm-admin.build-service (and on its own) AFTER the document templates are drafted and their tokens enumerated, to build the intake questionnaire that collects exactly those variables. Loaded as a discipline, not usually invoked directly by the attorney.
user_invocable: false
---

## Purpose

Build the intake questionnaire that collects what the service's documents need — no more, no less. The questionnaire is REVERSE-ENGINEERED from the templates' `{{tokens}}`: each token becomes one field, and the field's `id` is the stable name that binds the template to the answer at merge time. Build it second (after the documents), never first.

Apply `firm-admin.platform-discipline`: the questionnaire is a proposal the attorney approves; it is agent-sourced, reasoning-traced, honest-confidence.

## Before you begin — you need the variable list

You cannot build this questionnaire correctly without the enumerated token list from `firm-admin.author-template`. If you do not have it, get it first. The questionnaire's job is to COVER every template token: no missing tokens (a missing token renders `[[MISSING: token]]` in the client's document), and minimal extra fields (a field no template uses is wasted client effort).

**Full coverage is enforced, and reuse comes first.** `propose_questionnaire` will REFUSE any questionnaire that leaves a template token uncovered — so you cannot hand the attorney a form with holes to patch by hand; cover every token before you propose. Before authoring a new field, check `get_questionnaire_context` for a question the firm ALREADY defines for that token (same id) on another service and REUSE its definition (id / label / type) rather than re-inventing it.

**SYSTEM tokens are excluded from coverage — never ask the client for them.** Tokens the platform resolves itself — firm identity (`firm_name`, `firm_address`, `firm_phone`, `firm_email`), the approving attorney (`attorney_name`, `attorney_email`), dates (`today`, `letter_date`, `effective_date`), matter facts (`matter_number`, `client_name`, `client_email`), and the fee/clause slots — do not appear in the token list `get_questionnaire_context` returns, and they need no questionnaire field. Do not create fields for them: a client-facing field whose id is one of these is automatically forced to `internal: true` (the client is never asked for attorney/firm/system data).

## The binding contract (read this first)

`field.id` IS the merge token. When a matter runs, the deterministic engine flattens every answer into a `{{field_id}} → value` map and fills the templates. So:

> Template token `{{member_name}}`  ⟷  questionnaire `field.id: "member_name"`

The names must match exactly (matching is case-insensitive, but author both in lowercase snake_case). This is the implicit variable contract — the NC SMLLC service's 24 fields each fill exactly one operating-agreement token, by name, with nothing orphaned on either side.

## Step 1: One field per token

Walk the union of template tokens. For each, create one field:

- `id` — exactly the token name (snake_case).
- `label` — the plain-language question the client reads ("What's the LLC's name?", not "entity_name").
- `type` — from the closed whitelist (Step 2).
- `required` — true unless genuinely optional.

## Step 2: Use ONLY the closed field-type whitelist

The platform validates the questionnaire against a FIXED set of field types (`KNOWN_FIELD_TYPES`). Using anything else throws on save. The allowed types are exactly:

| type | use for | notes |
|---|---|---|
| `text` | short free text (names, titles) | |
| `textarea` | long free text (descriptions, purpose) | |
| `select` | single choice from a list | requires a non-empty `options: string[]` |
| `yes_no` | a Yes/No answer | stored answer is the chosen label |
| `true_false` | a True/False answer | stored answer is the chosen label |
| `checkbox` | multi-select from a list | requires `options: string[]`; answer is a string[] |
| `date` | a calendar date | maps to a `{{...date}}` token |
| `number` | a numeric value | e.g. ownership_pct |
| `address_autocomplete` | a postal address | structured; merges as the formatted address |
| `members_repeater` | a repeating group (e.g. multiple members) | requires a non-empty `memberFields[]` of sub-fields |
| `file_upload` | the client attaches document(s) at intake (e.g. the contract/lease to review) | the files bind to the matter on submit; the stored answer is the filename(s) — REQUIRED for any document-review service |

Match the type to the token's nature: a `{{effective_date}}` token → `date`; `{{principal_office_address}}` → `address_autocomplete`; `{{ownership_pct}}` → `number`; a multi-member LLC's members → `members_repeater` with sub-fields. `select`/`checkbox` fields MUST carry a non-empty `options` array; `members_repeater` MUST carry non-empty `memberFields`.

## Step 3: Structure into sections

The questionnaire is `sections[] → fields[]`. Each section has a unique `id` and a `title`; each field lives in a section. Group related questions ("The Company", "The Member(s)", "Management & Ownership") so the booking form reads like a coherent interview, not a flat list. Section ids must be unique.

## Step 4: Apply the humane-intake flags

Two optional flags make intake humane (both default false/absent):

- `allow_unknown` — the client may check "I don't know" instead of answering. The "I don't know" answer is treated as unanswered and renders the token as `[[MISSING]]` for the attorney to fill, rather than forcing a guess. Set this on fields a client plausibly won't know off-hand.
- `ask_attorney` — flags the question for attorney follow-up. Use for items the attorney typically supplies or confirms (e.g. a legal-structure choice) rather than the client.

Use these so the form never traps a client who genuinely doesn't have an answer.

## Step 5: Write good questions

- Ask in the client's language, not the document's. Token `registered_agent_name` → "Who will be the LLC's registered agent?"
- One fact per field. Don't bundle two facts into one question.
- Offer choices where the document expects a closed set (a `management_structure` token → `select` with options `["Member-managed", "Manager-managed"]`) so the answer is always merge-ready.

## Step 6: Confirm coverage, then propose

Before proposing, verify the contract holds both ways:

```
Coverage check (this service):
  Template tokens:   24
  Questionnaire fields that fill them: 24/24  ✓
  Orphan tokens (would render [[MISSING]]): none  ✓
  Unused fields (no template uses them): none  ✓
```

Present the questionnaire as one approval card with your honest confidence (< 1.0) and a one-line reasoning summary. The attorney approves, edits, or rejects. On save it is validated against the closed contract; if validation reports an unsupported type or a missing section id/options/memberFields, fix and re-propose.

## What this skill does not do

- It does not guess what to ask — it derives every field from a template token.
- It does not use field types outside `KNOWN_FIELD_TYPES` — that whitelist is closed and validated on save.
- It does not leave a token uncovered or add a field no template uses — coverage is one-to-one with the documents.
