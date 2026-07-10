---
slug: firm-admin.author-template
name: Author a Document Template
practice_area: firm-admin
description: Draft a service's document template as real legal work product using the firm's legal skills, write it with {{token}} merge fields, then enumerate every token — those tokens become the questionnaire fields (the documents→variables→questionnaire contract).
when_to_use: Applied by firm-admin.build-service (and on its own) when authoring a document template for a service — an operating agreement, engagement letter, notice, resolution, cover letter, or any document the client receives. Loaded as a discipline, not usually invoked directly by the attorney.
user_invocable: false
---

## Purpose

Draft a document template that a service uses to produce real client documents — and do it as genuine legal work product, not a hollow shell. A template is a markdown body with `{{token}}` merge fields. When a matter runs, the deterministic merge engine fills each `{{token}}` from the client's intake answers. So two things have to be true: the legal substance has to be real, and every token has to map to a real intake field. This skill produces both.

Apply `firm-admin.platform-discipline` throughout: the draft is a proposal the attorney approves; it is agent-sourced, reasoning-traced, honest-confidence; you do not own the legal judgment.

## Before you begin

- **Jurisdiction.** North Carolina + U.S. federal law unless the attorney says otherwise. Carry the jurisdiction into the document's choice-of-law, governing-statute references, and any state-specific formalities.
- **Know the document kind.** An operating agreement, engagement letter, demand letter, board resolution, and filing cover letter are each different work product with different required provisions. Identify the kind before drafting.

## Step 1: Draft using the firm's legal skills (real work product)

Do NOT draft from generic memory. LOAD the firm's matching legal-domain skill for the document's substance and let it carry the legal weight:

- Entity formation, operating agreements, board minutes, written consents, corporate governance → the **corporate** skills.
- Trademark/patent/clearance, IP assignment, licensing clauses → the **ip** skills.
- Offer letters, handbooks, separation/termination, classification → the **employment** skills.
- NDAs, vendor/SaaS agreements, MSAs → the **commercial** skills.
- Privacy policies, DPAs → the **privacy** skills.

Use the loaded skill for the real provisions, the right statutory hooks, and the jurisdiction-specific formalities — so the result is something the attorney would actually send, defaulted to NC + federal. All of the accuracy and citation discipline still applies: never invent a statute number, code section, or case cite; name the governing law generally and flag it for verification when you are not certain of the exact section. A confident wrong citation is worse than none.

The document is a **deliverable**, not chat prose. Draft the COMPLETE document.

## Step 2: Write the merge fields as {{tokens}}

Every value that varies per client is a `{{token}}` merge field, not hardcoded text.

- Token format is `{{snake_case_id}}`. The merge engine matches `{{ field }}` and `{{field}}` and is case-insensitive (so `{{Member_Name}}` fills a `member_name` field) — but author tokens in lowercase snake_case for consistency. It does NOT support dotted paths or nested structures (`{{member.0.name}}` will render `[[MISSING: member.0.name]]`). Repeater data (a `members_repeater` field) is captured at the questionnaire level via that field's `memberFields`, not by composing dotted merge tokens — so for repeating content, write the fixed legal language once and let the per-member facts live in the questionnaire structure rather than trying to merge `{{member.0.*}}` tokens.
- A token that has no matching intake field renders as a VISIBLE honest marker `[[MISSING: token]]` at merge time — never a blank and never a guess. That is the substrate being honest about a gap; your job is to make sure it does not happen by covering every token in the questionnaire (Step 4).
- Use tokens for client facts: `{{entity_name}}`, `{{member_name}}`, `{{principal_office_address}}`, `{{ownership_pct}}`, `{{effective_date}}`, `{{client_email}}`. Leave fixed legal language as literal text.

Example fragment:

```markdown
# Operating Agreement of {{entity_name}}

This Operating Agreement is entered into as of {{effective_date}} by
{{member_name}}, the sole member of {{entity_name}}, a North Carolina
limited liability company with its principal office at
{{principal_office_address}}.
```

## Step 3: Set the document metadata

- **Category — document vs email.** A *document* is a deliverable the client downloads/signs (operating agreement, engagement letter). An *email/notice* is correspondence. Tag the template's kind/category correctly so the workflow attaches it to the right step (a `review_send_document` step for a deliverable).
- **Typed-variable metadata.** Where the platform supports typed variables, declare each token's type (text, date, number, address, choice) so the questionnaire field that fills it gets the right control. The token's type and the questionnaire field's type must agree (an `{{effective_date}}` token ↔ a `date` field; a `{{principal_office_address}}` token ↔ an `address_autocomplete` field).
- **Signability — ASK: "does the finished document get signed, and by whom?"** For every *document* template, ask this with an `ask_build_question` (choices: not signed / client / client + attorney / other signers) — or derive it silently when the walkthrough already answered it (relevance rule). Write the answer as the `signature` field ON the `propose_template` call — `{ required: true, signer_roles: ['client', ...] }` (roles from: `client`, `attorney`, `witness`, `notary`) — so the card shows it and approving declares it on the firm-library template. **Default is unsigned** — when the attorney says no one signs it, or genuinely has no answer, omit the field. This declaration is what lets the workflow builder compose an e-signature step after the step that drafts this document; an unsigned template can never get an e-sign step.

## Step 4: Enumerate the tokens — the variable list IS the questionnaire spec

This is the critical hand-off. After drafting, ENUMERATE every distinct `{{token}}` the document needs and present that list. These tokens become the questionnaire fields, one-to-one, by name.

```
Document: Operating Agreement (NC SMLLC)
Variables this document needs (each becomes one intake question):
  • entity_name              (text)
  • member_name              (text)
  • principal_office_address (address)
  • effective_date           (date)
  • ownership_pct            (number)
  • management_structure      (choice: member-managed / manager-managed)
  ...
```

Hand this list to `firm-admin.author-questionnaire`. THE CONTRACT: every `{{token}}` in the final template MUST match a questionnaire `field.id` by name. This is the NC SMLLC discipline — its operating agreement's tokens and its 24-field questionnaire are a tight one-to-one contract, every token filled by exactly one field. No orphan tokens (which would render `[[MISSING]]`), no field the documents don't use.

When multiple templates are in one service, take the UNION of all their tokens — the questionnaire must cover the whole set.

## Step 5: Propose the template for approval

Present the drafted template + its enumerated variable list as a single approval card. The attorney owns the legal content — they approve, edit, or reject. Carry your honest confidence (< 1.0) and a one-line reasoning summary. Only an approved template proceeds to be bound into the workflow.

## What this skill does not do

- It does not guess legal substance from generic memory — it loads the firm's legal skill for real work product.
- It does not leave tokens uncovered — every `{{token}}` is enumerated and handed to the questionnaire builder so it maps to a field.
- It does not finalize anything — the attorney approves the draft; the template binds into the service only after approval.
