---
slug: litigation.matter-intake
name: Matter Intake
practice_area: litigation
description: Runs a structured intake for a new litigation matter — covering identification, conflicts status, source, risk triage, materiality, outside counsel, internal owners, legal hold, key dates, and initial posture — and presents a complete intake record for attorney review.
when_to_use: When the attorney wants to open a new matter, bring a new dispute or proceeding into the system, or capture a uniform intake record for a complaint, demand letter, subpoena, regulatory inquiry, or internal litigation report.
user_invocable: true
---

## Purpose

Every new matter goes through the same intake so the portfolio stays consistent. Uniform fields let the firm roll up status across matters. The narrative captures what fields can't.

If a matter and client are already in your current context, confirm whether this intake is for that matter or a new one. If no matter is in context, ask the attorney for the matter name before proceeding.

**Every output produced by this skill is a draft for attorney review, not legal advice and not a legal opinion. The attorney owns every legal conclusion, every risk rating, and any decision to file, send, or rely on this intake record.**

---

## Step 1 — Identification

Ask the attorney (or read from context):

- **Matter name** — as commonly referenced (e.g., "Smith v. Acme 2026")
- **Counterparty**
- **Matter type:** `contract | employment | ip | regulatory | investigation | product | other`
- **Our role:** `plaintiff | defendant | claimant | respondent | investigated`
  - If the attorney has told you the firm's default side (plaintiff / defense / varies by matter), pre-fill from that and confirm.
  - If the default side is plaintiff-only: route risk triage toward case value and contingency economics.
  - If defense-only: route toward exposure, reserves, and insurance tender.
  - If the default is not known, ask cold. Never silently assume a posture.
- **Jurisdiction** — court, arbitration forum, or regulatory body. If not yet known, note "TBD." Default assumption is North Carolina courts unless stated otherwise — surface this assumption explicitly.

---

## Step 2 — Conflicts check

Run this step before going further. This skill does not perform the conflict check — it records the result and makes sure the check happened.

Ask the attorney:

- **Status:** `cleared | pending | not-run | waived`
- **Method:** `corporate-legal | outside-counsel | system-check | informal | other`
- **Cleared by:** name / team / firm
- **Cleared date:** YYYY-MM-DD
- **Entities checked:** counterparty, known affiliates, adverse counsel if known, key witnesses (a brief list — thin is fine; "none" is not)
- **Notes:** anything flagged but cleared (e.g., a prior relationship that was determined non-overlapping)

**Behavior by status:**

- **`cleared`** — proceed.
- **`pending`** — proceed with intake; flag prominently in the intake record that conflicts are outstanding. Remind the attorney on every follow-up for this matter until resolved.
- **`waived`** — rare; capture that a waiver exists, who signed it, and where it lives. Do not draft the waiver — that is outside this skill.
- **`not-run`** — **STOP. This is a gate.** Do not produce a final intake record until the attorney picks one of three paths:

  **Path 1 — Run conflicts now.** Pause intake. Return with `cleared` or `waived` plus rationale.

  **Path 2 — Mark pending with owner and due date.** Allowed only when the attorney explicitly confirms parallel intake is acceptable for this matter. Capture: who is running conflicts, when results are expected, and what entities are being checked. The intake record carries `conflicts status: pending` and is flagged on every subsequent review until resolved.

  **Path 3 — Bypass with documented rationale.** Only if the attorney explicitly acknowledges the bypass. Record: who authorized it, the date, and the rationale. This field is visible in every future review of this matter and is never removed by this skill — only by the attorney's explicit edit after conflicts are actually cleared.

  Do not proceed silently. "I'll do it later" is not an acceptable response. One of Path 1, 2, or 3 must be chosen and captured.

---

## Step 3 — Source

How did this matter arrive?

`demand-letter | complaint-served | subpoena | regulator-inquiry | internal-report | pre-suit-threat`

If the attorney can share the initiating document (complaint, demand, subpoena), ask them to paste or summarize key allegations. It sharpens the intake and the initial theory.

---

## Step 4 — Risk triage

Ask the attorney (or apply firm positions from context if provided):

- **Severity:** high | medium | low — and briefly why
- **Likelihood of adverse outcome:** high | medium | low — and briefly why
- **Resulting risk rating (from the 3×3 matrix):** critical | high | medium | low
  - Critical = high severity + high likelihood
  - High = high severity + medium likelihood, or medium severity + high likelihood
  - Medium = medium/medium, or high/low, or low/high
  - Low = low/low or low/medium
- **Damages exposure range** — best estimate in dollars
- **Non-monetary exposure** — injunction, consent decree, publicity, precedent-setting, regulatory bar

If the attorney's risk calibration for this matter is thin at intake, don't fake precision. Use the attorney's gut and note the thinness explicitly in the record. Surface the assumption and flag it for revision once more facts are known.

---

## Step 5 — Materiality

Ask whether this matter rises to materiality thresholds (financial reporting, board notification, insurance tender, or other internal thresholds the attorney has set):

- **Status:** `reserved | disclosed | monitored | none`
- If `reserved`: reserve amount and whether finance / management has been notified
- If `disclosed`: where and in what filing or communication

If the attorney has provided firm-level materiality thresholds in context, apply them. If not, ask one question: "Does this matter trigger any reporting, reserve, or notification obligation?"

---

## Step 6 — Outside counsel

- Firm name
- Lead partner / attorney
- Lead attorney email (used for drafting status requests)
- Engagement letter status: `signed | pending | none`
- Budget authorization: amount and approver

If you can share the engagement letter, note it. If risk is medium or higher and no outside counsel is assigned, flag it explicitly.

---

## Step 7 — Internal owners

Who inside the firm or client organization is involved? Capture roles relevant to this matter:

- Business lead / client contact
- HR partner (if employment matter)
- Communications contact (if reputational risk)
- CISO or IT (if data or cyber element)
- Other

If the attorney has described the firm's team structure in context, draw from it. If not, ask.

---

## Step 8 — Legal hold

- Has a legal hold been issued for this matter?
- If yes: hold date, scope (subject matter and date range), and list of custodians
- Next refresh date — default six months from issuance unless the matter warrants something different
- If no hold has been issued and this is active litigation or reasonably anticipated: flag urgently. Offer to run the Legal Hold skill after intake completes. Do not issue the hold yourself — flag the gap and let the attorney decide.

---

## Step 9 — Key dates

- Response deadline (answer, objection, opposition, or regulatory response)
- Next hearing or conference
- Statute of limitations cutoff (if applicable — note the applicable NC or federal limitations period if you can identify it; surface the assumption)
- Any other regulatory or contractual deadlines

**Jurisdiction note:** North Carolina's general contract limitations period is 3 years (N.C. Gen. Stat. § 1-52(1)); tort is 3 years (§ 1-52(16)); UCC sales is 4 years (§ 25-2-725). Federal causes of action vary. Always surface the assumption and flag for attorney verification — do not treat a limitations calculation as definitive without attorney review.

---

## Step 10 — Initial posture

Ask the attorney for a one-paragraph working theory:

- What is the firm's client's story?
- What is the counterparty's likely story?
- What is the pivot fact (the fact that, if it goes one way, the matter tilts strongly)?
- Initial posture: `fight | settle | investigate | wait`

This is a working hypothesis at intake — not a commitment. Mark it explicitly as subject to revision once discovery, outside counsel, or further facts change the picture.

---

## Output — Intake record

After gathering answers, present the full intake record in chat for the attorney to review and save in the app. Do not file, send, or act on anything in this record — present it for review.

```
[DRAFT — ATTORNEY-CLIENT PRIVILEGED WORK PRODUCT — FOR REVIEW ONLY]

# Matter Intake: [Matter Name]

**Opened:** [YYYY-MM-DD]
**Our role:** [plaintiff / defendant / claimant / respondent / investigated]
**Status:** [threatened / active / closed]

---

## Identification

- **Counterparty:** [name]
- **Matter type:** [contract / employment / ip / regulatory / investigation / product / other]
- **Jurisdiction:** [court, forum, or regulatory body — note "NC courts assumed" if not specified]
- **Source:** [demand-letter / complaint-served / subpoena / regulator-inquiry / internal-report / pre-suit-threat]

---

## Conflicts

- **Status:** [cleared / pending / not-run / waived]
- **Method:** [corporate-legal / outside-counsel / system-check / informal / other]
- **Cleared by:** [name]
- **Cleared date:** [YYYY-MM-DD]
- **Entities checked:** [list]
- **Notes:** [flags cleared, waiver reference, or bypass rationale if Path 3]

---

## Risk triage

- **Severity:** [high / medium / low] — [brief rationale]
- **Likelihood:** [high / medium / low] — [brief rationale]
- **Risk rating:** [critical / high / medium / low]
- **Exposure:** [dollar range]
- **Non-monetary:** [injunction / consent decree / publicity / precedent / none]

---

## Materiality

- **Status:** [reserved / disclosed / monitored / none]
- [Reserve amount and notification status, or disclosure location, as applicable]

---

## Outside counsel

- **Firm:** [name]
- **Lead:** [name] — [email]
- **Engagement:** [signed / pending / none]
- **Budget:** [amount — approver]

---

## Internal owners

- **Business lead:** [name]
- **HR partner:** [name or N/A]
- **Comms contact:** [name or N/A]
- **Other:** [as applicable]

---

## Legal hold

- **Issued:** [yes / no]
- [If yes: issued date, scope, custodians, next refresh date]
- [If no: flag whether one should be issued — attorney to decide]

---

## Key dates

| Date | Description |
|------|-------------|
| [YYYY-MM-DD] | [Response deadline / hearing / SoL cutoff / other] |

---

## Initial theory `[WORKING HYPOTHESIS — SUBJECT TO REVISION]`

[Our story / their story / pivot fact / initial posture]

---

## Open questions

[Anything material that is not yet known — e.g., "insurance tender pending," "unclear whether coverage applies to this claim type," "outside counsel not yet retained"]

---

## Documents attached at intake

| Document | Status |
|----------|--------|
| [Initiating document] | [Shared / not yet shared] |
| [Engagement letter] | [Signed / pending / not yet shared] |
| [Legal hold notice] | [Issued / not yet issued] |
```

---

## Next steps — decision tree

After presenting the intake record, close with a concrete next-steps prompt:

> **What would you like to do next?**
> 1. Save this intake record to the matter in the app
> 2. Flag open items and set a follow-up reminder
> 3. Draft a legal hold notice (if not yet issued)
> 4. Draft an outside counsel engagement or budget request
> 5. Something else — tell me

The attorney picks. This skill presents; it does not act.

---

## What this skill does not do

- **Run the conflicts check.** It records the result, status, method, and entities checked. The actual clearance is the attorney's judgment and their firm's or client's process.
- **Decide the initial theory.** It captures what the attorney says; it does not invent one.
- **Issue the legal hold.** It flags the gap if a hold is missing; the attorney issues it (use the Legal Hold skill).
- **Look up court dockets, statutes, or case law** directly — use web_search if the attorney asks for a public-records lookup, and note the limits of what web search can and cannot surface reliably.
- **Connect to Westlaw, CourtListener, or any case-management system.** If the attorney needs a docket pull or case search, ask them to share the results or use web_search as a limited substitute, and flag that web search is not a reliable substitute for a proper docket or research platform.
