---
slug: corporate.material-contract-schedule
name: Material Contract Disclosure Schedule
practice_area: corporate
description: Build the material contracts disclosure schedule for a purchase agreement from diligence findings, applying the agreement's own definition of "Material Contract" and its required schedule format.
when_to_use: When the attorney asks to build a contracts schedule, disclosure schedule, Schedule 3.X, or material contracts list, or is drafting disclosure schedules for an M&A transaction.
user_invocable: true
---

## Purpose

The purchase agreement contains a rep: "Schedule 3.X lists all Material Contracts." This skill builds that schedule from diligence findings — identifying which contracts are material under the agreement's own definition, in the format the agreement requires.

Every output is a draft for the attorney's review. Nothing here is legal advice or a legal opinion. The attorney owns every legal conclusion and is responsible for all deliverables.

---

## Matter context

If a matter or client is in your current context, ground the analysis in it. If no matter is in context, ask the attorney which transaction or matter this is for before proceeding. Do not apply findings or schedule entries across matters without the attorney's instruction.

---

## Step 1 — Get the definition

Ask the attorney to paste or describe the "Material Contract" definition from the purchase agreement draft. The PA definition controls — it is the test to apply mechanically to every contract in diligence. Do not substitute any default threshold you infer; use what the agreement says.

If the attorney has not yet supplied the PA definition, ask: "Can you paste the Material Contract definition from the purchase agreement, or describe the key prongs?"

Common prong categories to watch for (the PA definition is the authority — this is a checklist for reading it, not a substitute):

- Dollar-value threshold (annual or aggregate)
- Term length
- Change-of-control or anti-assignment provision
- Exclusivity or non-compete restriction
- Top-N customer or supplier contracts
- Real property leases
- IP licenses (in-bound or out-bound)
- Related-party agreements
- Government contracts
- Contracts outside the ordinary course of business

Deal structure matters: stock deals, asset deals, and mergers can change how an anti-assignment prong is interpreted. Regulated industries — healthcare, defense, financial services, telecom, government contracting — can add consent requirements that live outside the PA (for example, federal contract novation rules, sector-specific consent statutes). If the deal touches any of those, flag it and ask the attorney to confirm the applicable overlay; use web_search to surface the controlling rule if needed, and cite the source.

Jurisdiction assumption: if no governing law is stated, assume North Carolina and US federal law as applicable. Surface this assumption explicitly.

---

## Step 2 — Apply the definition to diligence findings

For each contract the attorney provides or describes from diligence, evaluate it against the PA's definition prong-by-prong:

| Contract | Meets prong(s) | Include |
|---|---|---|
| [name / description] | [e.g., annual value > threshold; CoC provision in §X] | Yes / No |

If the attorney provides a diligence log or contract list, work through it systematically. If information about a contract is incomplete, flag the gap — do not guess.

**Edge cases to flag for attorney decision (do not resolve these unilaterally):**

- Contract is just under a dollar threshold but appears operationally significant
- Contract meets a prong but is being terminated before closing
- Oral agreements, side letters, or unsigned term sheets that may or may not constitute contracts
- Contracts where the materiality call is genuinely close — present both sides and let the attorney decide

---

## Step 3 — Gather schedule data

For each contract that belongs on the schedule, collect the following fields. Flag any that are missing — do not substitute inferred values:

| Field | Source |
|---|---|
| Counterparty name | Contract |
| Contract title / type | Contract |
| Execution date | Contract |
| Term / expiration date | Contract |
| Annual or total value | Contract or management representation |
| Which materiality prong(s) it meets | Step 2 analysis |
| Consent required for the transaction | Diligence finding |
| Document reference (VDR number, file name, or location) | Attorney's diligence inventory |

---

## Step 4 — Format per the agreement

Match the format, numbering, and sub-part structure of the other schedules in the purchase agreement draft. If the attorney provides a schedule format or template, follow it exactly. If not, use this standard form and ask the attorney to confirm it matches the agreement:

```
## Schedule 3.[X] — Material Contracts

The following are the Material Contracts as of the date hereof:

### (a) Customer Contracts

1. [Agreement Title], dated [date], between [Target] and [Counterparty].
   [Brief description if the format calls for it.]
   [Ref: [document reference]]

2. [...]

### (b) Supplier Contracts

[...]

### (c) Real Property Leases

[...]

### (d) IP Licenses

[...]

[Additional sub-parts per the agreement's definition structure]
```

Present the drafted schedule in chat. The attorney should save it in the app or copy it to their working documents — do not treat the chat output as the final delivered document.

---

## Step 5 — Consent tracking overlay

Track consent requirements separately from the schedule itself — this is an internal working document, not delivered to the buyer as part of the schedule exhibit.

| Schedule ref | Counterparty | Consent required | Triggering provision | Status | Owner | Due |
|---|---|---|---|---|---|---|
| 3.X(a)(1) | [name] | Yes — CoC §[X] | [§ cite] | Requested / Received / Waived | [name] | [date] |

**Privilege and confidentiality note:** The consent overlay and any pre-delivery working draft of the schedule are derived from privileged diligence materials and inherit their privilege and confidentiality status. Distribution beyond the privilege circle — including sharing with the buyer or third parties — can waive attorney-client privilege. The schedule itself, once delivered as an exhibit to the executed purchase agreement, is a deal document and is not privileged; strip any internal working annotations before delivery.

Present the consent overlay in chat for the attorney's use in closing-checklist tracking.

---

## Step 6 — Cross-check before delivering

Run through this checklist before presenting the final draft to the attorney:

- [ ] Every contract that met any prong in the PA definition is on the schedule (completeness)
- [ ] No contract is on the schedule that does not meet at least one prong (no over-disclosure — this is a rep, not a data dump)
- [ ] Schedule is internally consistent with other reps (a contract on Schedule 3.X that creates a lien should also appear on the liens schedule)
- [ ] Every entry has a document reference so buyer's counsel can locate the underlying document
- [ ] All flagged edge cases are presented to the attorney; none resolved unilaterally

If the attorney's context does not provide enough information to complete a section, identify the gaps and ask one focused question to resolve the most important one. Do not fabricate contract details.

---

## What this skill does not do

- Does not decide the materiality definition — that is in the purchase agreement.
- Does not obtain consents — it tracks which ones are needed.
- Does not draft the underlying rep — it populates the schedule the rep references.
- Does not provide access to Westlaw, contract databases, or VDR systems. Work from documents and information the attorney provides; use web_search to research applicable legal rules (not deal-specific facts).
- Does not replace attorney judgment on any close or contested call.
