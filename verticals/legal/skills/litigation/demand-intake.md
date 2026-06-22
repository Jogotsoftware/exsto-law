---
slug: litigation.demand-intake
name: Demand Letter Intake
practice_area: litigation
description: Runs a structured pre-drafting intake for a demand letter — gathering parties, facts, legal basis, leverage, BATNA, and privilege filters — and presents a complete intake record for attorney review.
when_to_use: When the attorney wants to prepare a demand letter, run pre-drafting context gathering, or capture matter context for a payment demand, breach/cure notice, cease-and-desist, employment-separation notice, or preservation demand.
user_invocable: true
---

## Purpose

The drafting is downstream. The value is in the pre-writing — forcing the questions a careless letter skips. Leverage, BATNA, downside tolerance, privilege filters, the actual audience. A demand letter sent without thinking about those is worse than no letter.

If a matter and client are in your current context, ground the intake in them. If no matter is in context, ask the attorney which matter this belongs to before proceeding.

**Every output produced by this skill is a draft for attorney review, not legal advice and not a legal opinion. The attorney owns the legal conclusion and any decision to send.**

---

## Flags

- **Full intake** — the attorney can tell you to run the complete strategic block regardless of materiality heuristics.

---

## Step 1 — Posture for this matter (ask FIRST)

Demand-letter tone and terms are per-matter decisions, not firm defaults. Before anything else, ask:

- **Tone:** measured / assertive / aggressive? (Consider the relationship, the amount, and whether litigation is likely.)
- **Response window:** How long will you give the recipient to respond? (14 days is common for payment demands; 30 days for cure; 7 days for cease-and-desist — but the contract or an applicable rule may set it. Surface that assumption and ask.)
- **Marking:** Does this letter need a "without prejudice" or settlement-communication marker? (Settlement communications generally do; assertions of rights often don't. Jurisdiction matters — surface the question if unsure.)
- **Signer:** Who signs — the attorney, the client, the GC?

Do not assume defaults on any of these. If the attorney leaves one blank, ask again before proceeding. If the matter file or prior correspondence is shared with you, read it first — it establishes the register. Record the answers in the intake under **Posture** before the core questions.

---

## Step 2 — Core intake (always asked — 8 questions)

### 1. Demand type

`payment | breach-cure | cease-and-desist | employment-separation | preservation | other`

### 2. Parties

- **Sender:** firm's client (and specific entity, if multi-entity structure)
- **Recipient:** counterparty — name, entity, address
- **Recipient audience:** who actually reads this? (GC? CEO? individual? in-house legal?)
- **Relationship:** `customer | vendor | ex-employee | competitor | third-party | other`

### 3. Triggering event

- What happened and when. Dates matter — statute-of-limitations, notice periods, contractual cure windows.
- Evidence available: contracts, emails, invoices, records, witnesses.

If the attorney can share the underlying contract, correspondence, or evidence, the draft will be materially sharper. Ask whether they'd like to paste or summarize key provisions or correspondence.

### 4. Legal / contractual basis

- Which contract provisions apply (specific sections if known).
- Governing law — jurisdiction and any choice-of-law clause. Default assumption: **North Carolina law** unless stated otherwise. Surface this assumption explicitly.
- Statutes or rules relied on. Placeholders are fine here; the draft will flag `[CITE:___]` where authority needs to be pinned.

### 5. Desired outcome

- Specific asks — not "resolution." Payment of $X by date Y; cessation of specific activity Z; cure within N days; return of specific property.
- If multiple asks, order them: primary vs. fallback.

### 6. Deadlines

- External deadline driving this (statute of limitations, ongoing harm window, business event).
- Demand compliance deadline — how long we give the recipient. Use the response window captured in Posture above; do not substitute a default.

### 7. Prior outreach

- Has this been raised informally? When, by whom, in what form?
- Any response from the counterparty so far?
- Why is escalation to a demand letter happening now?

### 8. Distribution

- Delivery method (ask — no default).
- Signer — from Posture above.
- Copies — internal stakeholders, insurance carrier (if the matter involves a claim that may be tended to an insurer, flag that insurance-tender timing is a separate decision the attorney should make before sending), outside counsel if involved.

---

## Step 3 — Strategic block

Run the strategic block if any of the following apply:

- Demand type is `cease-and-desist`, `breach-cure`, `employment-separation`, or `preservation`
- The dollar amount or business impact appears material (ask the attorney if unsure)
- The counterparty is a customer, competitor, or repeat adversary
- The attorney asked for a full intake

**Offer an explicit skip.** When the strategic block is triggered, tell the attorney:

> This looks like a material demand. The strategic block — leverage, BATNA, privilege filters — is where most of the pre-writing value lives. Skipping it produces a thinner draft. Would you like to walk through it now, answer part of it, or skip and flag the gaps in the draft?

If they skip, record it and note in the intake that sections depending on strategic-block answers will be flagged `[SME VERIFY: leverage/tone/privilege not captured at intake]`.

### 9. Leverage and BATNA

- What gives the firm's client negotiating power — contractual rights, factual leverage, reputational, commercial.
- What if they refuse — is the client prepared to litigate? Accept a smaller outcome?
- The counterparty's likely BATNA — if they don't believe litigation is coming, the demand is weaker. Name that honestly.

### 10. Downside tolerance

- Reputational exposure if this becomes public.
- Precedent risk — does this letter set a pattern that affects other matters or the business relationship?
- Regulatory or disclosure implications.
- Insurance implications — does sending without tendering waive coverage? Flag this if there's any insurance angle; the attorney decides, not the assistant.

### 11. Tone trade-off

The tone was captured in Posture. Here, probe whether the chosen tone fits the facts:

- If aggressive tone was chosen but the relationship has ongoing business value — name that tension explicitly.
- Measured tone is usually the right call when the client wants to protect the legal position but preserve the relationship.
- The attorney makes the call; the assistant surfaces the trade-off.

### 12. Settlement-communication posture

- Is this letter a settlement communication (structured to compromise a disputed claim) or an assertion of rights?
- If it is a settlement communication, it should be marked and structured accordingly. Under Federal Rule of Evidence 408 and the North Carolina equivalent (N.C. R. Evid. 408), protection attaches to conduct and context — not merely to a label. A marker is belt-and-suspenders, not the substance of the protection. Surface this distinction.
- Use web search if the attorney asks for the specific rule in another forum, or if an unusual jurisdiction is involved.

### 13. Privilege filters

- What is in the firm's internal analysis that must NOT appear in the letter? Unverified facts, doubts about the case's strength, strategic reasoning, prior settlement discussions.
- A single badly-worded sentence can waive privilege on related analysis. Be explicit about what stays out.

### 14. Admission and accord-and-satisfaction risk

- Is anything in the proposed letter something the counterparty could later characterize as an admission of fact or liability?
- Could the letter inadvertently constitute or invite accord and satisfaction? (e.g., if the counterparty cashes a check or performs in a way that purports to close the dispute.) Flag any such risk for attorney review.

---

## Step 4 — Present the intake

Present the completed intake in chat using the structure below. Before finalizing, flag anything thin:

> Here's the intake. I notice [thin spots — e.g., governing law not confirmed, strategic block skipped, no evidence shared]. Anything to add before we move to drafting?

The attorney reviews, edits in chat, and saves to the matter in the app if they choose.

---

## Intake record format

```
[WORK PRODUCT — ATTORNEY-CLIENT PRIVILEGED]
[Draft only — for attorney review. Not legal advice.]

# Demand Intake: [title]

**Demand type:** [type]
**Opened:** [YYYY-MM-DD]
**Status:** intake | ready-to-draft | drafted | sent | closed
**Strategic block:** answered | partial | skipped
**Skipped reason:** [if applicable]

---

## Posture

- **Tone:** [measured / assertive / aggressive — with one-line rationale]
- **Response window:** [N days — tied to claim / contract / applicable rule]
- **Marking:** [none / without prejudice / other — with rationale]
- **Signer:** [name / role]

*Per-matter posture captured at intake. Governs the draft.*

---

## Parties

- **Sender:** [client entity]
- **Recipient:** [counterparty, entity, address]
- **Recipient audience:** [who reads]
- **Relationship:** [type]

## Triggering event

[What happened, when, evidence available]

## Legal / contractual basis

[Provisions, governing law (assumed NC unless stated), statutes]

## Desired outcome

[Specific asks in priority order]

## Deadlines

- **External:** [SoL, ongoing harm window]
- **Compliance deadline:** [how long we give them]

## Prior outreach

[History, most recent first]

## Distribution

- **Delivery:** [method]
- **Signer:** [name/role]
- **Copies:** [list]

---

## Strategic (if answered)

### Leverage & BATNA

[Client's power, counterparty's likely response]

### Downside tolerance

[Reputational, precedent, regulatory, insurance]

### Tone trade-off

[Relationship-preserving / measured / aggressive — with rationale]

### Settlement-communication posture

[Protected or assertion of rights — with reasoning and applicable rule]

### Privilege filters

[What CANNOT appear in the draft]

### Admission / accord-and-satisfaction risk

[Specific risks flagged]

---

## Supporting documents shared

| Document | Status |
|---|---|
| Underlying contract | [shared / not shared] |
| Prior correspondence | [shared / not shared] |
| Evidence | [shared / not shared] |

---

## Materiality assessment

**Heuristic:** [material / immaterial — with brief reasoning]
**Attorney call:** [material / immaterial / TBD]
```

---

## Next steps — decision tree

After presenting the intake, end with a next-steps decision tree. Customize to what the intake just produced. Defaults:

1. **Proceed to draft** — intake is complete; move to demand-letter drafting.
2. **Gather more facts first** — intake flagged gaps the attorney wants to close before drafting.
3. **Consult outside counsel or insurance** — materiality or insurance angle warrants it before a letter goes out.
4. **Negotiate directly instead** — some intake sessions end here; the intake record still has value even if no letter is sent.
5. **Something else** — attorney directs.

The attorney picks. The assistant does not pick.

---

## What this skill does not do

- **Draft the letter.** Intake and drafting are intentionally separate steps so the attorney can pause for business input, outside counsel consult, or insurance tender before committing to language. Ask the attorney when they are ready to move to drafting.
- **Decide whether to send the letter.** That is the attorney's decision. The intake record has value even if the answer is "don't send."
- **Run a conflicts check.** If the counterparty is a customer or known entity, flag that a conflicts check should clear before the letter goes out — but the check itself is outside this skill.
- **Access Westlaw, CoCounsel, or any external legal research platform.** For legal authority, use web search and any statutes or materials the attorney provides directly. Note the limits and flag where independent verification of authority is needed.
