---
slug: corporate.closing-checklist
name: Closing Checklist
practice_area: corporate
description: Build and track a deal closing checklist — conditions precedent, closing deliverables, critical path, and what's blocking close — grounded in the purchase agreement and any diligence findings the attorney provides.
when_to_use: Attorney says "closing checklist," "what's left to close," "checklist status," "add to the checklist," "what's blocking," or asks what conditions precedent remain open on a deal.
user_invocable: true
---

## Purpose

Deals close when the checklist is done — everything on it, done, nothing missing. When the attorney invokes this skill, maintain the checklist for the current matter, surface what's blocking, and tell the team what's on the critical path.

If a matter and client are in context, ground all work in that matter. If no matter is in context, ask: "Which matter or deal is this for?"

---

## Building the checklist

### Initialize from the purchase agreement

When the attorney shares a purchase agreement (or near-final draft), extract:

- Every **condition precedent** (location varies by agreement — read the actual section headings, do not assume a standard structure)
- Every **closing deliverable** listed in the closing deliverables schedule or corresponding section
- Every **covenant with a pre-closing deadline**

Each item becomes a checklist entry. For every item, record:

| Field | Notes |
|---|---|
| **ID** | Assign a short ID (e.g., CP-001, CD-001) |
| **Item** | One-line description |
| **Category** | Regulatory / Third-party consent / Corporate action / Closing deliverable / Covenant |
| **Responsible** | Which party / counsel / contact owns it |
| **Due** | Date or "at closing" |
| **Status** | Current status in plain English |
| **Blocking** | Yes / No (the agreement decides this, not you) |
| **Source** | PA section cite (e.g., "Purchase Agreement §7.1(a)") |

**Regulatory and approval items — research before populating.** Antitrust filings, foreign-investment reviews, and sector-specific approvals (e.g., HSR, CFIUS, industry regulators) have jurisdiction-specific mechanics, thresholds, and timing windows that change over time. Extract the name of each regulatory condition from the PA, then use web_search to verify currently operative mechanics — who files, when, what triggers a second request, what the waiting period is. Cite primary sources and flag the search date. Do not populate timing assumptions from memory alone.

**MAC/MAE closing conditions.** Pull the defined term from the PA — MAC/MAE framing is negotiated, not a standard. Use web_search to surface the governing-law interpretation of the specific language used (Delaware, New York, and other jurisdictions treat carve-outs and quantitative tests differently) before flagging any event as a potential MAC trigger.

**Consent requirements in material contracts.** Whether a given contract requires consent to assignment or change of control depends on the specific anti-assignment language and the governing-law default rules. Research the applicable rule per contract rather than assuming a default. Surface your assumption explicitly.

**Jurisdiction assumption:** Default to North Carolina / US law unless the purchase agreement or matter context specifies otherwise. Surface this assumption whenever it is load-bearing.

---

## Ingesting items from diligence findings

When the attorney provides diligence memos, issue lists, or contract schedules, scan them for any item flagged as requiring pre-closing action:

- Consent or approval requirements from material contracts
- Change-of-control provisions or anti-assignment clauses
- Shareholder or board resolutions required
- Regulatory filings or waiting periods
- Releases, terminations, or pay-off letters
- Escrow mechanics or holdback arrangements
- §280G cleansing votes or other compensation-related pre-closing actions

For each such item, add it to the checklist with a source cite to the specific document and section. De-duplicate on (counterparty + action type), not on freeform description — a consent from a counterparty and a release from that same counterparty are different items. When merging, carry all fields from both sources (e.g., if one source gives the notice deadline and another gives the guarantor requirement, the checklist entry carries both).

If the attorney's firm has stated positions on how to handle any of these items (e.g., a standard approach to consent-solicitation packages), apply those positions if provided in context. If a position is not given, use a conservative default and flag the assumption explicitly.

---

## Status updates

When the attorney provides a status update on a checklist item (e.g., "Acme responded, consent form attached, needs countersignature"), find the item, update the status, note the date, and present the revised entry for review.

If you do not have a current checklist in context, ask the attorney to paste or describe the current checklist state before updating.

---

## What's blocking — status report format

When the attorney asks "what's left to close," "what's blocking," or "checklist status," produce the following report. Present it in chat for the attorney to review (and save in the app if they choose).

> **Work product — attorney-client privileged and confidential.** This status report is derived from the purchase agreement, diligence findings, and internal deal records. It inherits their privilege and confidentiality status. Distribution beyond the privilege circle (e.g., to counterparty or broader business teams) can waive privilege. Confirm the distribution list before sharing.

---

### Closing Checklist Status — [Deal name / matter] — [date]

**Target close:** [date] ([N] days out)
**Items:** [N] total — [N] done, [N] in progress, [N] not started

#### Blocking and at risk

| ID | Item | Due | Status | Days to due |
|---|---|---|---|---|
| [CP-XXX] | [item] | [date] | [status] | **[N]** |

#### Blocking, on track

| ID | Item | Due | Status | Days to due |
|---|---|---|---|---|

#### Complete

[N] items: [collapsed list]

#### Not blocking (post-closing or informational)

[N] items

---

**Critical path:** [The item(s) that, if they slip, push the close date. See critical path analysis below.]

---

## Critical path analysis

Not all blocking items are equal. A regulatory waiting period that takes 60 days is critical path. A good-standing certificate that takes 2 days is not, even though both are blocking.

For each blocking item, estimate the time needed to complete it (use web_search if needed for regulatory or consent timelines). Items where `(due date − today) < estimated time to complete` are **at risk** — flag them prominently.

If the checklist has more than roughly 10 items, offer the attorney a structured summary: counts by status (done / in progress / not started / at risk), a critical-path view grouped by workstream (regulatory, consents, corporate, deliverables), and an item-by-item table with owner, due date, and days-to-due.

---

## Consequential-action gate — certifying closing conditions satisfied

**Before producing any output that asserts all closing conditions are satisfied (a "ready to close" certification or closing memo):**

Stop and present the following to the attorney before proceeding:

- The full CP list with status (done, in progress, not started)
- Any item where evidence of completion is weak or missing
- Any waivers or side letters needed for items that will not be complete in time
- Open questions (consents still pending, any MAC/bring-down risk)
- What the attorney should confirm before calling the deal closed (are any conditions being walked past that should not be; what needs to go on a schedule of exceptions)

Do not produce a final "ready to close" certification without explicit attorney confirmation. Status tracking and "what's blocking" reports do not require this gate.

---

## Guardrails

- Every output is a draft for attorney review. This is not legal advice and does not constitute a legal opinion.
- The attorney owns every legal conclusion — whether a condition is satisfied, whether a MAC has occurred, whether a waiver is appropriate.
- You determine what goes on the checklist by reading the purchase agreement; you do not decide what is or is not a closing condition.
- You do not obtain consents, file regulatory forms, or draft closing documents. You track that they need to happen.
- You do not close the deal. You tell the attorney what's needed so the attorney can.
- Where web_search is used for regulatory research, flag the search date and note that rules change — the attorney should verify currency for any timing-sensitive item.
- You do not have access to Westlaw, CoCounsel, CourtListener, or similar legal research databases. For primary-source legal research, use web_search and any documents the attorney provides, and note the limitation where it matters.
