---
slug: employment.investigation-add
name: Internal Investigation — Add Data
practice_area: employment
description: Process new documents, interview notes, or observations into an open internal investigation log — apply pull criteria to surface significant items, track coverage, and flag evidentiary gaps.
when_to_use: When the attorney pastes interview notes, a document batch, or new evidence into chat for an already-open internal investigation matter.
user_invocable: true
---

## Privilege notice — read before proceeding

**Marking does not create privilege.** Every output you produce in this skill carries the header below — but the header does not itself establish privilege. Whether any given output is actually privileged depends on whether the investigation is attorney-directed, the purpose for which documents were created, and how they are subsequently used or disclosed.

If you are unsure whether this investigation is attorney-directed, surface that question to the attorney before processing any data. Improperly labeled materials can create problems in discovery if privilege is later challenged.

**Work-product header** — prepend to every analysis, log entry summary, and draft this skill produces:

> PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT — PREPARED AT THE DIRECTION OF COUNSEL

**Distribution discipline.** Everything this skill produces inherits the privilege and confidentiality status of the underlying investigation. Distribution beyond the privilege circle — forwarding to non-attorneys outside the investigation team, cc'ing HR without scoping, handing to the business side — can waive privilege over the entire investigation. Present outputs only in chat, label them accordingly, and make every distribution decision deliberately.

---

## Step 1 — Identify the matter

If the current matter is in context (matter name, matter ID, or investigation description), use it. If no matter is in context or multiple open investigations exist, ask: "Which investigation does this data belong to? Give me the matter name or a brief description."

---

## Step 2 — Identify the data type

If it is not clear from what the attorney pasted, ask:

- Interview notes (whose interview?)
- Document batch (emails, records, files)
- Attorney notes or observations
- Upjohn warning confirmation

---

## Step 3 — Apply document pull criteria

For any document batch, apply the following pull criteria to every item. Surface a document if it meets **any** of the following. These criteria are intentionally set to pull slightly aggressively — a false positive is better than a missed significant item.

1. **Party names** — Contains the name of any party to the investigation (complainant, respondent, witnesses named in prior log entries or the attorney's description).
2. **Authorship/receipt in timeframe** — Authored or received by a party during the key conduct timeframe.
3. **Allegation keywords** — Contains keywords related to the allegation type. Update the keyword list as new terms emerge from accounts and flag new additions to the attorney.
4. **Admissions** — Contains explicit or implicit admissions: "I shouldn't have," "I know how this looks," "don't put this in writing," "delete this," or similar.
5. **Account contradiction** — Contains language that contradicts any account already in the log. Flag the specific contradiction and what it conflicts with.
6. **Litigation-sensitive language** — Discriminatory terms, threats, discussions of protected characteristics or protected activities, financial irregularities matching the allegation pattern.
7. **Mentioned-but-missing document** — Is a document type referenced in prior accounts that has not yet appeared in the document set (e.g., a meeting was mentioned in an interview but no calendar invite has come in). Log as an evidentiary gap, not a surfaced document.

**Disposition for every document reviewed:**

- `surfaced` — meets one or more pull criteria; summarize as a log entry below
- `reviewed / nothing significant` — reviewed; does not meet any criterion; note in the coverage count only

---

## Step 4 — Report the results

After processing, present the following summary before the log entries:

```
Document review complete.
Reviewed: [N] items
Surfaced as potentially significant: [N]
Logged as reviewed / nothing significant: [N]
New evidentiary gaps identified: [N]

Surfaced items:
[Numbered list — one-line description + which pull criterion triggered]
```

---

## Step 5 — Present log entries for surfaced items

For each surfaced item, present a structured log entry for the attorney's review (they can copy it into the matter record in the app, or you can reference it later in this conversation):

```
Entry type: [interview / document / attorney-note / gap]
Date of event: [date the event occurred, not when logged]
Source: [witness name/role, or document description]
Source type: [complainant / respondent / witness / document / attorney-note]
Issues addressed: [which allegation(s) this entry relates to]
Significance: [high / medium / background]
Summary: [2–5 sentences — what this entry adds to the record]
Verbatim quote: [if significant; otherwise omit]
Contradicts: [what earlier account or document, if any]
Corroborates: [what earlier account or document, if any]
Credibility note: [leave blank — attorney fills in]
Pull criterion: [which criterion triggered — for documents]
```

For evidentiary gaps identified:

```
Gap: [description of what should exist but hasn't appeared]
Identified from: [which account or document raised this]
Where to obtain: [suggested source]
Priority: [high / medium / low]
```

---

## Step 6 — Sources checklist update

After presenting log entries, ask: "Does this data cover any open checklist items for this investigation — such as a completed interview or a document set that's now in?" Do not auto-mark items complete; the attorney decides when a source is adequately covered.

If the attorney has not described the sources checklist for this matter, remind them that coverage tracking is part of the investigation record and offer to summarize open sources based on what they have told you about the matter.

---

## Reference — sources checklists by investigation type

Use the appropriate list when the attorney opens a new investigation or asks what sources are still open. Present these as a checklist and ask the attorney to confirm, remove inapplicable items, or add matter-specific sources.

**HR investigation (harassment / discrimination / retaliation):**
1. Complainant interview
2. Respondent interview
3. Witness interviews — identify from complainant and respondent accounts
4. Email/messaging review — parties, relevant date range
5. HR records — respondent's performance history, prior complaints, prior discipline
6. Prior complaints — any prior complaints against respondent in HR system
7. Comparator data — how were similar situations handled
8. Relevant policies — harassment, code of conduct, reporting procedures (version in effect at time of alleged conduct)
9. Org chart and reporting relationships at time of alleged conduct
10. Calendar records — any meetings or events mentioned in accounts
11. Upjohn warning documentation — confirm interviews were preceded by Upjohn warnings and documented

**Financial misconduct:**
1. Expense reports — subject, relevant period
2. Approval records — who approved the expenses or transactions
3. Vendor/contractor records — contracts, invoices, payment records
4. Financial system records — AP/GL entries for relevant accounts
5. Email/messaging review — subject, approvers, counterparties
6. Subject interview
7. Approver interviews
8. Counterparty/vendor interviews (if accessible)
9. Audit logs — system access logs for relevant accounts/systems
10. Prior audits or reviews covering the relevant period
11. Upjohn warning documentation

**Executive misconduct:**
1. Subject interview
2. Board/compensation committee records — relevant resolutions, minutes, approvals
3. Employment agreement and any amendments
4. Equity records — grants, exercises, vesting
5. Expense reports and approval records
6. Email/messaging review — subject, relevant counterparties
7. Conflict of interest disclosures (or absence thereof)
8. Outside business activity records
9. Witness interviews — direct reports, peers, board members
10. Prior complaints or concerns raised about subject
11. Upjohn warning documentation

**Whistleblower retaliation:**
1. Complainant interview
2. Original complaint or tip — written form if it exists
3. Records related to the underlying allegation (what the complainant reported)
4. Records related to any adverse action taken against complainant after the protected activity
5. Decision-maker interviews — who made the adverse action decision
6. Comparator data — treatment of similarly situated employees who did not engage in protected activity
7. Email/messaging review — decision-makers, relevant timeframe
8. Timing analysis — proximity of protected activity to adverse action
9. Respondent/decision-maker interviews
10. Upjohn warning documentation

---

## Special flags — surface immediately if any apply

**Weingarten flag.** If the respondent, complainant, or any anticipated witness is represented by a union or covered by a collective bargaining agreement, flag this before any interview proceeds. NLRA Section 7 and its state-law analogs may give employees the right to union representation at investigatory interviews. The protocol must be adjusted before interviews are conducted.

**Garrity flag.** If the employer is a public employer (government entity, public university, state or municipal agency) or otherwise acting under color of state law, flag this before any interview proceeds. Compelled statements in public-sector investigations carry use-immunity consequences under the Garrity line of cases and change how interviews must be conducted and documented. Do not interview until the attorney has reviewed the applicable rules.

**Jurisdiction note.** Defaults are US law (North Carolina law where state law is relevant). Flag if the investigation involves employees in other states or countries — applicable law on retaliation, protected activity, interview rights, and privilege may differ materially.

---

## What this skill does not do

- Make disciplinary decisions — that is the attorney's (and HR's) role, not yours.
- Guarantee privilege — privilege depends on how the investigation is structured, not on how outputs are labeled.
- Conduct interviews — you log and analyze interview notes; you do not interview witnesses.
- Give Upjohn warnings — you track whether they were given; the attorney administers them.
- Access Westlaw, case management platforms, or document-review tools — use web_search and the documents the attorney provides in chat. Note any gaps this creates.

---

## After presenting results — close with next steps

End every response with a short decision tree tailored to what was just processed. Example:

> **What's next?**
> - Add more documents or notes to this investigation
> - Query the investigation log (ask what evidence exists on a specific issue)
> - Draft or update the investigation memo
> - Draft an audience summary (for HR, leadership, or outside counsel)
> - Flag a coverage gap and discuss how to close it

The attorney picks. Every output is a draft for attorney review — not legal advice and not a final legal conclusion. The attorney owns the legal judgment.
