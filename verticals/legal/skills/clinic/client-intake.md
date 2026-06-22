---
slug: clinic.client-intake
name: Client Intake
practice_area: clinic
description: Structured new-client intake — practice-area triage, cross-area issue spotting, conflict flags, and triage classification — producing a formatted case summary for attorney review; does not decide case acceptance.
when_to_use: When starting an intake interview with a prospective client, writing up a new client's situation, or routing an incoming matter to the right practice area.
user_invocable: true
---

# Client Intake

## Purpose

Intake is one of the biggest bottlenecks in a solo or small firm. Structured intake accelerates the information-gathering and write-up — so attorney time goes to analysis, not transcription.

**What this skill does NOT do:** decide whether to take the case. That is the attorney's judgment. This skill structures what the client told you so the attorney can spend time on analysis.

**Every output is a draft for attorney review, not legal advice and not a legal opinion. The attorney owns the legal conclusion.**

## Privilege and confidentiality

This summary is derived from client communications that may be privileged, confidential, or both. It inherits the source's privilege status. Distributing it beyond the privilege circle can waive privilege. Keep intake summaries in the firm's privileged file, mark them appropriately, and clear distribution decisions with the attorney.

## Context grounding

If a matter or client is already loaded in your context, ground all intake facts in it. If no matter is in context, ask the attorney which matter this intake belongs to (or confirm it is a prospective client with no matter yet) before producing the summary. If firm-specific intake positions or checklists have been provided in context, apply them; if a position is not given, ask the attorney one short question or use a conservative default and explicitly flag the assumption.

---

## Workflow

### Step 1: Practice-area routing

Ask the client (or the attorney paraphrasing the client):

> "Tell me what's going on — what brought you in today?"

Route to the appropriate practice-area template below. Pacheco Law is a North Carolina business-law firm — the default jurisdiction is **North Carolina / US federal** unless a different jurisdiction is stated; surface that assumption in the output. If the problem spans multiple areas (e.g., a business dispute that also implicates an employment claim), note all relevant areas — cross-area issue spotting is a feature, not a bug.

### Step 2: Practice-area-specific intake

Use any practice-area intake checklist the attorney provides in context. If none is provided, use the defaults below and note the assumption.

**Business / Commercial (primary practice):**
- Nature of the business relationship (vendor, customer, partner, employee, contractor)
- What happened: breach, non-payment, fraud, dispute over deliverables, dissolution
- Governing documents in hand: contract, operating agreement, term sheet, purchase order
- Applicable law clause or place of performance (NC by default)
- Damages: quantified or estimated; economic vs. other
- Timeline urgency: any notice deadlines, answer deadlines, statute-of-limitations concerns

**Corporate / Entity:**
- Entity type and state of formation
- What is sought: formation, restructuring, governance dispute, dissolution, equity issue
- Existing governing documents
- Other stakeholders: co-owners, investors, board members
- Timeline urgency: any pending votes, deadlines, or regulatory filings

**Employment (for business clients — employer side):**
- Nature of the employment relationship: at-will, contract, classification (employee vs. contractor)
- What happened: termination, wage dispute, discrimination claim, non-compete issue, EEOC charge
- Documentation: offer letters, agreements, handbook, any demand or agency filing
- Timeline urgency: EEOC response windows, answer deadlines, arbitration triggers

**Real property / Lease (business context):**
- Type: commercial lease, purchase, title issue, zoning, landlord-tenant (commercial)
- What happened: breach, eviction, condition dispute, closing dispute
- Documentation: lease, deed, purchase agreement, any notice received
- Timeline urgency: notice dates, cure periods, closing deadlines

**Generic (when practice area is unclear):**
- Narrative in client's own words
- Documents the client has
- Opposing party name(s)
- What outcome the client wants
- Any known deadlines

### Step 3: Cross-area issue spotting

While running the practice-area template, listen for issues outside that area:

| Client says | Also flags |
|---|---|
| "My partner/co-owner is threatening me" | Possible business divorce / dissolution urgency |
| "They said I owe taxes on this" | Tax issue — may need referral |
| "I signed a non-compete" | Employment / restrictive covenant — separate analysis |
| "This happened in another state" | Conflict-of-laws / out-of-NC jurisdiction issue |
| "I received a government notice" | Regulatory / administrative — flag |
| "They're taking money from my account" | Possible fraud, conversion, or banking claim |
| "My employee filed a complaint" | EEOC / NCDOL administrative timeline — urgent |

Note every cross-area issue in the summary. The attorney decides whether to handle, refer, or both.

### Step 4: Conflict-check flags

At minimum, surface:
- Opposing party name(s) — does the firm represent or have represented them?
- Related parties — anyone else who might create a conflict?
- Positional conflicts — does this representation require arguing something that would hurt another current client?

Flag for attorney review. Do not resolve the conflict — surface it.

### Step 5: Triage classification

This is a triage input, not a case-acceptance decision:

| Classification | Means |
|---|---|
| **Urgent** | Deadline in days, safety issue, or irreversible harm imminent |
| **Time-sensitive** | Deadline in weeks, harm ongoing but not immediately irreversible |
| **Standard** | No immediate deadline, can queue normally |
| **May be out of scope** | Issue outside the firm's practice areas — flag for referral |

### Step 6: Deadline identification

If the intake surfaces any deadline (answer due date, hearing date, statute-of-limitations cutoff, cure period, filing window, notice deadline, contractual response window), call it out explicitly in the summary. Present it as a clearly labeled item for the attorney to verify and calendar — do not compute jurisdiction-specific deadlines yourself; flag the triggering event and the relevant rule or statute, and note that the attorney must confirm the exact date.

---

## Output format

Present the result in chat for the attorney to review. The attorney may save it to the matter in the app if they choose.

```
# Intake Summary: [Client name or matter reference]

---
[AI-ASSISTED DRAFT — requires attorney review before any reliance, filing, or advice]
---

**Date:** [date] | **Practice area:** [primary + any cross-area flags]
**Jurisdiction assumed:** North Carolina / US federal [flag if different]

## Bottom line

[Preliminary framing only — e.g., "Appears to be a breach-of-contract matter under NC law; conflict check needed; time-sensitive given the alleged notice date." Do NOT state a legal conclusion. The attorney owns that.]

## Client's situation (in their words)

[The narrative the client gave, before legal categorization. Human story first.]

## Legal issues identified

Every citation in this section carries a provenance tag:
- `[attorney provided]` — attorney uploaded or stated the source in this session
- `[official source]` — fetched this session from a government or court website via web_search
- `[web search]` — found via web_search this session; verify before relying
- `[model knowledge — verify]` — from training data; must be independently verified before use

### Primary ([practice area])
- [Issue 1]: [one line, with cite tagged if cited]
- [Issue 2]: [one line]

### Cross-area flags
- [Other area]: [what the client said that raised it]
  [UNCERTAIN: attorney call on whether to handle or refer]

## Key facts

| Fact | Source | Documentation status |
|---|---|---|
| [fact] | [client statement / document provided] | [have it / need it] |

## Conflict check

**Opposing party:** [name(s)]
**Related parties:** [any]
**Flag:** [Clear to proceed pending check / Needs conflict check before accepting]

## Triage

**Classification:** [Urgent / Time-sensitive / Standard / May be out of scope]
**Driving deadline:** [if any — describe the triggering event and the relevant rule; attorney must verify the exact date]

## Deadlines to calendar

[List each surfaced deadline. For each: describe the event, the triggering document or fact, the applicable rule or statute (tagged), and note "Attorney must compute and verify exact date." If no deadline was surfaced, omit this section.]

## Jurisdictional notes

[NC-specific or federal issues relevant to this matter type. All cites tagged per vocabulary above. Default is NC law unless the matter implicates another jurisdiction — surface that assumption explicitly.]

---

## Verification checklist for the attorney

Before analysis or advice, verify:
- [ ] [Specific fact the intake relies on — confirm with client or documents]
- [ ] [Any deadline — confirm from the actual notice or document, not client's memory]
- [ ] [Any legal citation above marked `[model knowledge — verify]` — look it up before relying on it]
- [ ] Conflict check completed

## What this summary does NOT do

This summary does not decide whether the firm takes this case. It does not constitute legal advice to the client. It does not resolve the conflict check. It structures what the client communicated so the attorney's time goes to analysis, not transcription.
```

---

## Next-steps decision tree

End every intake by presenting these options to the attorney — customize to what the intake just produced:

1. **Draft the engagement letter / retainer agreement** — if the attorney is ready to accept the matter
2. **Get more facts** — list the specific gaps that must be filled before analysis is possible
3. **Run a conflict check** — if opposing party names need to be cleared first
4. **Refer out** — if the matter is out of scope or there is a conflict; offer to help draft a referral note
5. **Watch and wait** — no immediate action; calendar a follow-up date
6. **Something else** — attorney directs next step

The attorney picks. This skill does not pick.

---

## Guardrails summary

- Every output is a draft for attorney review — not legal advice, not a legal opinion.
- The attorney owns the legal conclusion.
- Privilege: treat all intake content as potentially privileged; do not paste outside the privilege circle.
- Jurisdiction: default NC / US federal; surface the assumption; adjust if attorney states otherwise.
- Citations: always tag provenance; default `[model knowledge — verify]` when uncertain.
- Deadlines: identify and flag; never compute a jurisdiction-specific deadline as authoritative.
- Conflict check: flag, do not resolve.
- Case acceptance: attorney's call, not yours.
