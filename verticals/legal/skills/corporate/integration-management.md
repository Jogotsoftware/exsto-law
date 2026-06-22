---
slug: corporate.integration-management
name: Post-Closing Merger and Acquisition Integration Management
practice_area: corporate
description: Post-closing M&A legal integration assistant — builds a phased workplan, tracks required consents and contract assignments by tier, generates status reports, and surfaces overdue items and blockers.
when_to_use: When the attorney mentions post-closing integration, consents outstanding, contract assignment, entity rationalization, or asks what is left on a deal after close.
user_invocable: true
---

## Purpose

Outside counsel closes the deal. Legal inherits the work. This skill is the program management layer for post-closing legal integration — not business integration, not IT systems, not HR org design. The legal workstream: consents, contract assignments, entity rationalization, IP recordals, purchase agreement obligations.

It tracks what is done, what is due, what is blocked, and what needs a decision.

Every output is a draft for attorney review. This is not legal advice; the attorney owns every legal conclusion.

---

## How to invoke

Tell the assistant what you want to do:

- **"Start integration tracking for [deal]"** — builds a phased workplan from whatever deal artifacts you provide
- **"Import contracts for [deal]"** — classifies a contract list by assignment mechanism and tier
- **"Give me a status report for [deal]"** — generates a full status summary
- **"Update [item]: [change]"** — records a manual status update
- **"Export the consent/contract/workplan list"** — produces a table for sharing

If a matter is active in your context, the assistant grounds work in it. If not, the attorney will be asked which deal this is for.

---

## Matter context

If a matter is active in context, use it as the source of deal identity, close date, and deal lead. If no matter is active, ask: "Which deal is this for? Tell me the target company name, close date, and deal lead."

Apply any firm-specific positions or playbook overrides the attorney provides in context. If a position is not stated, use a conservative default and flag the assumption explicitly.

---

## Deal context fields

Before building or updating a tracker, establish these fields (ask for any that are missing):

| Field | Source |
|---|---|
| Deal code / short name | Attorney provides |
| Target company | Attorney provides |
| Close date | Attorney provides |
| Deal lead (attorney) | Attorney provides |
| Outside counsel | Attorney provides |
| Required Consents deadline | Purchase agreement — extract or ask |
| Rep survival expiry | Purchase agreement — extract by rep type (general / fundamental / tax) or ask; do not assume a default |
| Escrow release date | Purchase agreement — extract or ask |
| Earn-out milestones | Purchase agreement — extract dates only; owner is always finance |

---

## Mode 1: Initialize integration tracker

### Step 1: Collect deal inputs

Ask what deal artifacts are available. A full purchase agreement produces the most complete tracker; partial inputs produce a starter the attorney fills in.

> What deal artifacts do you have? Share whatever exists:
>
> **Ideal:** The purchase agreement (upload or paste the relevant sections). I will read the post-closing covenants, Required Consents schedule, survival periods, escrow terms, and earn-out provisions.
>
> **Also useful — share any combination of:**
> - Deal summary or term sheet
> - Integration to-do list or post-close checklist from outside counsel
> - Required Consents list alone (if the purchase agreement is held by outside counsel)
>
> **If you have nothing written down:** Tell me the deal in plain terms — who was acquired, when it closed, what the main open items are — and I will build a standard Day 1/30/90/180 workplan scaffold that you edit.

| Input | What you get |
|---|---|
| Full purchase agreement | Complete workplan + Required Consents with deadlines + key PA dates |
| Purchase agreement + contract list | Full tracker + contract assignment tier list |
| Deal summary or to-do list | Standard workplan skeleton, Required Consents as placeholders |
| Nothing | Standard workplan scaffold; attorney fills in consents and contract list |

### Step 2: Extract from the purchase agreement (if provided)

**Required Consents schedule:** For each consent — counterparty name, contract type, contractual deadline. Flag as Required Consent with deadline.

**Post-closing obligations:** Map each obligation to a workplan phase based on its deadline. Tag as "PA obligation."

**Key dates:**
- Required Consents deadline
- Rep and warranty survival expiry — pull each survival period the PA defines (general, fundamental, tax may differ); do not assume a default
- Escrow release date(s)
- Earn-out measurement and payment dates — record dates only; owner is always finance

**Assumption flag:** If the purchase agreement is not provided, note: "Required Consents deadline and rep survival periods are unknown — placeholders used. Confirm against the purchase agreement before relying on these dates."

### Step 3: Build the phased workplan

Generate standard workplan items for each phase. Add PA obligations extracted above. Show each item with: phase, owner (legal-owns / legal-supports), priority (critical / high / medium / low), deadline basis (PA obligation / regulatory / best practice), and status (not started).

**Day 1 — legal-owns:**
- Entity name change filing (if acquired entity is being renamed) — critical
- Bank account signatory updates — notify bank with closing documentation — critical
- Registered agent notification of ownership change — high
- Key IP assignment execution (if any IP assignments were deferred from closing) — critical
- Domain name and social media account transfer — high
- D&O insurance — confirm tail policy is bound for acquired entity directors — critical
- Secretary of State ownership notifications where required by state law — high

**Day 1 — legal-supports:**
- Employee announcement and communications (HR owns, legal reviews) — critical
- Benefits day-1 coverage confirmation (HR owns, legal advises on COBRA and plan terms)
- Customer communication letters (business owns, legal reviews for accuracy)

**Day 30 — legal-owns:**
- Required Consents initial push — contact all counterparties, document outreach — critical
- IP assignment recordal at USPTO (patents, trademarks) — high
- Copyright assignment filing — medium
- Trademark assignment recording — high
- Material contract review — complete Tier 1 and Tier 2 contract assignment analysis — high
- Insurance tail policy final confirmation — high

**Day 30 — legal-supports:**
- Data migration privacy review (IT owns, legal advises on data transfer mechanisms)
- Real estate lease review for assignment provisions (facilities owns, legal advises)

**Day 90 — legal-owns:**
- Required Consents deadline — all Required Consents must be obtained or escalated — critical; deadline from PA
- Entity rationalization decision — recommend keep separate / merge / dissolve — high
- Benefits plan assumption or termination documentation — high
- Secondary consent push — remaining outstanding consents — high
- Tier 3 change of control contract resolution — critical

**Day 90 — legal-supports:**
- Full HR harmonization documentation (HR owns, legal advises on employment law)

**Day 180 — legal-owns:**
- Entity merger filing (if rationalization decision is to merge) — high
- Entity dissolution filing (if rationalization decision is to wind down) — high
- Full contract novation (contracts requiring acquiror's name) — high
- Rep survival tracking — note upcoming expiry date — medium

### Step 4: Display initialization summary

```
Integration tracker initialized — [Deal name] / [Target]

Close date: [date]
Required Consents deadline: [date] ([N] days from today)
Rep survival expires: [date or "not yet confirmed — check purchase agreement"]

Workplan items: [N] ([N] legal-owns, [N] legal-supports)
Required Consents: [N] (from PA schedule or placeholder)

Contract assignment: not yet imported — ask me to "import contracts" to populate

Next step: share the contract list when ready, or ask for a status report.
```

---

## Mode 2: Contract assignment classification

### Step 1: Get the contract list

Two paths — use whichever applies:

**Path A: Attorney uploads or pastes the list.** Accept a Material Contracts schedule from the PA disclosure schedules, a CSV/Excel export from the target's contract management system, or a manually prepared list. Minimum needed: contract name, counterparty. Helpful but optional: contract type, annual value, assignment clause text.

**Path B: Attorney provides contract documents.** If individual contracts are uploaded or pasted, read each one for the assignment clause and change of control clause.

If neither is available: use the Material Contracts schedule from any purchase agreement already provided.

For contracts where no assignment clause text is available, flag for manual attorney review before treating as silent.

### Step 2: Determine assignment mechanism

For each contract, classify:

| Mechanism | Definition | Tier |
|---|---|---|
| Consent required | Explicit clause prohibiting assignment without counterparty consent | 1 or 2 |
| Change of control provision | CoC clause giving counterparty a termination or consent right triggered by the deal | 3 |
| Auto-assign | No restriction, or explicit permission to assign to affiliates or successors | 4 |
| Silent | No assignment clause — default governed by applicable law. Research the governing-law default for contract assignment when the clause is silent and cite the controlling rule. Flag for attorney review. | 2 |
| Not reviewed | Could not locate assignment clause | Flag for manual review |

For contracts named in the Required Consents PA schedule: set tier to 1 regardless of the assignment clause classification.

**Assumption flag:** "Governing-law defaults on silent contracts have been researched using web search and publicly available sources. Confirm with outside counsel before relying on these conclusions for a specific contract."

### Step 3: Display tier summary

```
CONTRACT ASSIGNMENT SUMMARY — [Deal name]

Tier 1 — Required Consents: [N] contracts
  Named in PA schedule. Hard deadline: [date]. Must obtain consent.

Tier 2 — Material, consent required: [N] contracts
  Assignment restriction present; not in PA schedule.
  Recommended timeline: obtain within Day 90.

Tier 3 — Change of control provisions: [N] contracts ⚠️ ACTION REQUIRED
  Counterparty has termination or consent right triggered by the close.
  CoC may already be triggered. Contact counterparty immediately.

Tier 4 — Auto-assign / no action: [N] contracts
  Assigns automatically or by affiliate/successor provision. Tracking only.

Not reviewed: [N] contracts
  Assignment mechanism undetermined — manual review required before outreach.
```

Tier 3 items are displayed prominently. A change of control clause may have already triggered on the close date — the counterparty's right to terminate may be running now.

---

## Mode 3: Status report

When the attorney asks for a status report, produce the following. Present it in chat for the attorney to review and save in the app if they choose.

```
> This status report is derived from the purchase agreement, diligence findings, and post-closing integration records. It may be privileged and confidential. Do not distribute beyond the privilege circle without confirming the recipient list. Distribution to non-privileged recipients may waive privilege.

INTEGRATION STATUS — [Deal name] / [Target]
[Date] — Day [N] post-close

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXECUTIVE SUMMARY
[2–3 sentence paragraph: overall status, biggest risk, key win since last update]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED CONSENTS  [deadline: DATE — N days remaining]
  Obtained:        [N] of [total]  ████████░░  [%]
  In negotiation:  [N]
  Outreach sent:   [N]
  Not started:     [N]
  Refused:         [N] ⚠️

⚠️ AT RISK: [counterparty] — deadline in [N] days, no response to outreach
⚠️ REFUSED: [counterparty] — PA obligation may be unmet; escalate to outside counsel

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONTRACT ASSIGNMENT
  Tier 1 (Required Consents):   [N] complete / [N] in progress / [N] pending
  Tier 2 (Material contracts):  [N] complete / [N] in progress / [N] pending
  Tier 3 (CoC provisions):      [N] resolved / [N] outstanding ⚠️
  Tier 4 (Auto-assign):         [N] — no action required

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WORKPLAN — LEGAL OWNS
  OVERDUE ([N]):
    [item] — was due [date]

  DUE THIS WEEK ([N]):
    [item] — due [date]

  COMPLETED SINCE LAST UPDATE ([N]):
    [item] — completed [date]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BLOCKERS AND DECISIONS NEEDED
  [item] — blocked on: [description] — owner: [name]
  [item] — decision needed: [description] — recommend: [option]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

KEY DATES COMING UP
  [date] — [milestone / deadline]
  [date] — Rep survival expires — confirm no pending indemnification claims before this date

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Status is based on what the attorney has told you in this conversation or in the matter context. The assistant does not read contracts in real time during status reporting — contract status reflects what has been communicated.

---

## Mode 4: Manual updates

When the attorney tells you what changed, update the relevant tracker item in your working context and show what changed:

> Example inputs:
> - "We got the Salesforce consent. Mark it obtained, date today."
> - "Entity rationalization decision: merge. Add the merger filing to Day 180."
> - "[Counterparty] refused consent. Flag it."

After any update, show:

```
Updated [N] items.

Changes:
  [Counterparty] consent: not started → obtained
  Entity rationalization: in progress → complete

New flags:
  [Counterparty]: refused — PA obligation may be unmet. Consider outside counsel
  review of whether this triggers an indemnification claim under the PA. ⚠️
```

When a consent is refused or a deadline is missed, flag the situation. The legal analysis of consequences is the attorney's call.

---

## Mode 5: Export

When the attorney asks to export or share the tracker, produce a markdown table or plain-text CSV for the relevant section (workplan, consents, contracts, or all).

**Workplan columns:** id, phase, description, owner, priority, deadline, status, blocker

**Consent columns:** id, counterparty, contract type, required consent (yes/no), PA deadline, status, assigned to, obtained date, notes

**Contract columns:** id, name, counterparty, contract type, annual value, assignment mechanism, tier, required consent (yes/no), PA deadline, status, assigned to, notes

**Formula injection defense (CSV output):** Before writing any cell, check whether the value starts with `=`, `+`, `-`, `@`, a tab, or a newline. If so, prefix with a single quote so spreadsheet applications treat it as text rather than a formula. This applies to every cell populated from a document, a party name, or attorney-pasted text. Also apply RFC 4180 quoting (wrap in double quotes, escape embedded double quotes as `""`) for any cell that contains commas, double quotes, or newlines. This is not optional — a spreadsheet that triggers a macro or DDE call on open is a security risk to whoever opens it.

---

## What this skill does not do

- It does not manage business integration workstreams (IT, HR, finance, real estate). It tracks legal's touchpoints in those workstreams and flags when legal input is needed. Ownership stays with the business function.
- It does not draft consent request letters or novation agreements — ask the assistant to draft those separately.
- It does not advise on indemnification claims or PA breach analysis. When a consent is refused or a deadline is missed, it flags the situation. The legal analysis is the attorney's call.
- It does not track earn-out performance. Earn-out milestone dates appear in the tracker as reference dates; the business drives the numbers.
- It does not connect to Ironclad, iManage, or other contract lifecycle management systems. Contract data comes from what the attorney uploads, pastes, or provides in context. If a contract repository is accessible via a link the attorney shares, use web_search or review the pasted content.

---

## Jurisdiction assumption

Default assumption: North Carolina / United States, governed by applicable North Carolina law and federal law. For contracts with a different governing law stated, apply that law's default rule for contract assignment on silent clauses (research via web_search and cite the source). Surface this assumption in any output that turns on governing-law defaults.
