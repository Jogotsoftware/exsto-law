---
slug: corporate.entity-compliance
name: Entity Compliance Tracker
practice_area: corporate
description: Tracks annual reports, franchise taxes, Statements of Information, and other recurring entity filings across jurisdictions — surfaces what is overdue, due soon, or unknown for a client's entity portfolio.
when_to_use: When the attorney asks about entity filing deadlines, annual reports due, good-standing status, "what filings are due," entity health, foreign qualification gaps, or compliance calendars for a client's entities.
user_invocable: true
---

## Purpose

Annual reports, franchise taxes, Statements of Information, biennial filings — every entity in every state has its own schedule and its own consequences for missing a deadline. This skill helps you track what is due, when, and for which entity across a client's portfolio.

When a client or matter is in context, ground your work in those entities. If no entity data is in context, ask the attorney to identify the client and list the entities, or paste in a compliance report from a registered agent.

Output is always presented in chat for the attorney to review and save in the matter if they choose. This skill does not file anything.

> **Every output is a draft for attorney review, not legal advice and not a filing instruction.** The attorney owns every legal conclusion and every representation made to a Secretary of State.

---

## Deadline reference caveat

> Filing deadlines summarized here reflect publicly available requirements. State filing requirements and due dates can change. **Always confirm deadlines with the registered agent or directly with the relevant Secretary of State before relying on them for compliance purposes.** If the client uses CT Corp, National Registered Agents, or another registered agent service, their compliance calendar is authoritative for the specific entities — use this skill to organize and surface that data, not to replace it.

---

## Jurisdiction assumption

> Deadline calculations are based on the state or country of formation/qualification recorded for each entity. Filing rules, due-date mechanics, and fee structures vary materially by jurisdiction. If an entity's actual footprint differs from what the attorney provides (undisclosed foreign qualification, dissolved entities, re-domestication, international filings managed by a local agent), the output may not apply — confirm with the registered agent or local counsel for that jurisdiction. Where no jurisdiction is specified, default to **North Carolina / US** and surface that assumption explicitly.

---

## Entity-type disambiguation (especially Delaware)

The filing calendar depends on **entity type**, not just jurisdiction. Treating "a Delaware entity" as a single bucket is a common and consequential error.

**Delaware — the split that matters:**

- **DE Corporation (Inc., Corp.):** Annual report AND franchise tax, both due **March 1**. Franchise tax is calculated by the authorized-shares method or the assumed-par-value capital method (whichever is lower). Statutory basis: 8 Del. C. §§ 501–502 [confirm current].
- **DE LLC:** No annual report required. Annual tax is a **flat $300**, due **June 1**. Statutory basis: 6 Del. C. § 18-1107(d) [confirm current fee and date].
- **DE LP:** No annual report required. Annual tax is a **flat $300**, due **June 1**. Statutory basis: 6 Del. C. § 17-1109 [confirm current].

If an entity's type is not confirmed, flag it as type-unknown and ask the attorney to confirm before computing either deadline. Never copy a deadline from one entity type to another in the same state.

Apply the same discipline in every jurisdiction with divergent filing regimes by entity type (e.g., CA corporation Statement of Information vs. CA LLC SOI cadence; TX franchise tax thresholds differ by entity type).

---

## Entity data and positions

Apply entity details — name, type, state of formation, jurisdictions, registered agent, formation date — from whatever the attorney provides in context (a matter record, a pasted list, an uploaded registered agent report, or direct instruction).

If a position or detail is not provided (formation date, whether a foreign qualification exists in a given state), ask one short clarifying question or use a conservative default and explicitly flag the assumption.

If the attorney uploads a compliance report from a registered agent (PDF, CSV, or Excel), extract entity names, filing types, due dates, last filed dates, fees, and good-standing status from it. Flag near-matches for confirmation ("Acme Holdings LLC" vs. "Acme Holdings, LLC" are probably the same entity — confirm before treating them as one).

For jurisdictions not in the standard reference (international filings, less-common US state regimes), capture what the attorney tells you and flag anything you cannot confirm. Do not invent deadlines or fees.

---

## What to build and present in chat

When the attorney asks you to check compliance status, run a report, or audit entity health, present the following structured output in chat. Adapt the sections to what the attorney actually needs (a quick report for one entity, a sweep of unknowns, a full audit).

### Compliance report

```
ENTITY COMPLIANCE REPORT — [date]
[Client / Matter]

OVERDUE ([N]):
  [Entity] / [State] / [Filing type] — was due [date]

DUE WITHIN [N] DAYS ([N]):
  [Entity] / [State] / [Filing type] — due [date]  [registered agent if known]

RECENTLY FILED ([N] in last 90 days):
  [Entity] / [State] / [Filing type] — filed [date]

UNKNOWN STATUS ([N]):
  [Entity] / [State] / [Filing type] — no information; confirm with registered agent

AGENT-MANAGED ([N]):
  [Entity] / [Country] / [Filing type] — managed by [local agent]; confirm status directly
  [Entity] / [Country] — no local agent recorded; flag for the attorney

GOOD STANDING:
  Last confirmed: [date]
  Entities with confirmed good standing: [N] of [total]
  Entities not confirmed in last 12 months: [list]
```

Default window: next 90 days. If the attorney specifies 30, 60, or 180 days, use that window.

### Status values

- **Current** — filed for current period; nothing due within 90 days
- **Due soon** — due within 90 days
- **Overdue** — past due date; no filed date recorded
- **Unknown** — no information; flag for confirmation with registered agent

### Health audit

When the attorney asks for a broader entity health review, surface:

**Filing compliance:**
- Overdue items
- Unknown status items (flag for sweep/confirmation)

**Entity health:**
- Entities marked as dormant — flag for review: should these be dissolved? Carrying dormant entities costs money (annual fees, registered agent fees) and creates ongoing compliance obligations.
- Dormant entities older than 5 years — flag as dissolution candidates.
- Entities missing formation dates — flag as data gaps.

**Good standing gaps:**
- Entities with no confirmed good-standing date — unknown whether in good standing; risk if a transaction requires a certificate on short notice.
- Entities with good-standing confirmation older than 12 months — stale; worth refreshing if M&A or financing is anticipated.

**Foreign qualification gaps:**
- For each state in the client's operational footprint (offices, employees) where an entity is not foreign-qualified: flag the question for the attorney to confirm. You cannot determine operational presence independently — flag it, do not conclude it.

**Intercompany agreement gaps:**
- If the attorney provides entity relationship information: flag which entity relationships may need agreements (parent-subsidiary services, IP licenses, intercompany loans) if they are not confirmed as documented.

```
ENTITY HEALTH AUDIT — [date]

FILING COMPLIANCE
  Overdue: [N]
  Unknown status: [N]
  Recommended next step: confirm unknown items with registered agent

DORMANT ENTITIES ([N])
  [List of dormant entities with age and annual carrying cost if known]
  Dissolution candidates (>5 years dormant): [list]

GOOD STANDING
  No record: [N] entities
  Stale (>12 months): [N] entities
  Consider refreshing before: [any upcoming transactions or contract renewals if known]

POTENTIAL GAPS
  Foreign qualification: confirm operational presence in — [list of states in footprint not confirmed as qualified]
  Intercompany agreements: [status if known]

RECOMMENDED ACTIONS
  1. [Highest priority action]
  2. [etc.]
```

---

## Consequential-action gate

Before directing or confirming that a filing should be made or recorded as filed, confirm the attorney has reviewed and approved it. Filing a Statement of Information, annual report, or franchise tax return with a Secretary of State is a formal representation from the entity; it carries fees; and missed or incorrect filings can cause loss of good standing or franchise-tax defaults.

If a non-attorney appears to be using the output to make a filing decision without attorney review, surface this:

> Filing a [filing type] with [Secretary of State] has legal consequences — it is a formal representation from the entity, carries fees, and errors can cause loss of good standing. Please confirm with the attorney (or a qualified registered agent) before filing. Here is what to bring to that review: [entity, jurisdiction, filing type, due date, last filing date if known, open questions about officer/director information or registered agent changes].

Do not record a new filed date or mark an item as current without an explicit attorney confirmation.

---

## International jurisdictions

International filings vary enormously by jurisdiction. Always confirm with the attorney what is known, and flag what must be confirmed with the local filing agent or registered office agent before populating any deadlines. For international entities:

- Ask whether a local filing agent or registered office agent handles compliance. If yes, note the agent — the report should flag when to follow up with them rather than showing a calculated due date.
- Ask whether group-level filings are required in that jurisdiction (e.g., country-by-country reporting, beneficial ownership registers, economic substance filings).
- Mark international entities with a local agent as agent-managed in the output. Show them in the "Agent-Managed" section of the report rather than computing due dates.

For anniversary-based filings: calculate from the formation date if provided. If formation date is unknown, flag the entry as unknown status.

---

## Web search use

This skill does not have access to Westlaw, a registered agent portal, or a live Secretary of State database. If the attorney asks you to confirm a specific jurisdiction's current filing requirements:

- Use web_search to look up the Secretary of State's official website for the relevant state/country.
- Cite the source and the date retrieved.
- Explicitly note that filing requirements can change and the attorney should confirm directly with the Secretary of State or registered agent before relying on the result.

Do not invent or guess at filing deadlines not confirmed by the attorney or a retrieved source.

---

## Tabular and CSV export

When the attorney asks for a table or CSV export to share with finance, legal ops, or a registered agent, produce a flat output with one row per filing per jurisdiction.

**Columns:** Entity Name, Entity Type, State of Formation, Formation Date, Status, Registered Agent, Jurisdiction, Qualification Type, Filing Type, Due Date, Last Filed, Last Fee, Good Standing Confirmed, Notes.

**Formula injection defense:** Before writing any cell, neutralize formula injection. If any cell value (entity name, registered agent name, notes, quoted text) starts with `=`, `+`, `-`, `@`, a tab, or a newline, prefix it with a single quote so it renders as text rather than executing. Escape embedded commas, double-quotes, and newlines per RFC 4180 for CSV output. This applies to every value sourced from a document, registered agent report, or user paste — not just column headers.

---

## What this skill does not do

- It does not file anything. Output is a to-do list and a draft tracker; filing is done by the attorney, outside counsel, or registered agent.
- It does not pull good-standing certificates. It notes when certificates were last confirmed; obtaining them is manual or via registered agent.
- It does not determine whether foreign qualification is required in a given state. That analysis depends on facts about business activity the attorney must confirm.
- It does not replace a registered agent service. CT Corp, National Registered Agents, and similar services have dedicated compliance teams and direct state relationships. This skill is best suited for smaller organizations without agent support, or as a lightweight layer on top of agent-provided data.
- Deadline summaries are not legal advice and may not reflect current requirements. Confirm all deadlines before relying on them.
