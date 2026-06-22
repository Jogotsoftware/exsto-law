---
slug: ip.portfolio
name: Intellectual Property Portfolio Manager
practice_area: ip
description: Track IP registrations, renewals, maintenance fees, and use declarations — surface what is due, add or update assets, and audit the portfolio for gaps and lapses.
when_to_use: When the attorney asks what IP is renewing soon, wants to add or update a portfolio asset, needs to record a maintenance filing, or wants a health check on the firm's or a client's IP holdings.
user_invocable: true
---

# Intellectual Property Portfolio Manager

Surfaces what is renewing, helps add assets, records filings, and audits the register for gaps and lapses.

> **Every output is a draft for attorney review — not legal advice, not a legal opinion.** Computed deadlines are reference only. The attorney owns the legal conclusion, including whether to renew, file a declaration, or let an asset lapse.

---

## How to invoke

Tell the assistant what you need:

- **"Show me what IP is due soon"** — deadline report (default 90-day window)
- **"Show me IP due in the next 30 / 60 / 180 days"** — adjust the window
- **"Add an IP asset"** — walk through adding a new trademark, patent, copyright, design, or domain
- **"Record a filing / update an asset"** — record that a maintenance action was completed, or change an asset's status
- **"Audit the IP portfolio"** — broader health check beyond near-term deadlines

If a matter or client is in context, ground everything in that matter. If not, ask which client's portfolio to work on.

---

## Sources of portfolio data

This assistant tracks what you tell it. For the most reliable deadline picture:

- **Paste or upload your docket export** (spreadsheet, CSV, PDF) and the assistant will parse and track from there.
- **If you use an IP management system** (Anaqua, CPA Global, AppColl, Alt Legal, Clarivate, etc.) — paste the relevant export or copy the key fields; the assistant cannot connect directly, but it can structure and surface what you provide. Your IP management system remains the authoritative docket.
- **If neither is available** — the assistant will walk through assets interactively.

Without a live registry feed, the assistant computes deadlines from dates you supply. It does **not** verify status against USPTO TSDR, WIPO Madrid Monitor, or any other registry. Always confirm computed deadlines against the registry before acting.

---

## Jurisdiction and type rules

Maintenance mechanics vary. The assistant applies these rules by default (jurisdiction: US unless stated otherwise — surface the assumption if it matters):

**US trademarks**
- §8 Declaration of Use: file between the 5th and 6th anniversary of registration (§71 for Madrid designations). 6-month grace period with surcharge.
- §9 Renewal (combined with §8): due at the 10-year anniversary and every 10 years thereafter. 6-month grace with surcharge.
- §15 Incontestability: available after 5 years of continuous use — not a renewal requirement but a valuable filing window.
- Key question before §8: is the mark actually in use in commerce on all registered goods/services? If use is uncertain, flag before preparing the declaration.

**Madrid International trademarks**
- 10-year term from registration, renewable at WIPO. Individual designated countries may impose local declaration or use requirements (e.g., US §71). Confirm with the foreign associate or local agent in each jurisdiction.

**EUIPO trademarks**
- 10-year renewal; 6-month grace with surcharge.

**US utility patents**
- Maintenance fees due at 3.5, 7.5, and 11.5 years from grant date.
- 6-month grace window with surcharge; after that, potential revival by petition if lapse was unintentional.
- Entity size (large / small / micro) drives USPTO fees — confirm before paying.

**US design patents**
- No maintenance fees for the 15-year term (applications filed on or after May 13, 2015; 14 years if earlier). No mid-term action required.

**EPO / national patents**
- Annuities typically due annually from the filing date or national phase entry. National rules vary — confirm per jurisdiction with the foreign associate.

**US copyright**
- Works created 1978 or later: no maintenance required.
- Pre-1978 works: may have had renewal obligations. Flag any asset pre-dating 1964 for attorney review.

**Domains**
- Annual or multi-year renewal per registrar. Typical 30-day grace then ~30-day redemption period (at elevated cost) then drop. Auto-renew status is worth confirming.

**Jurisdictions not listed above**
- Capture the maintenance mechanic when adding the asset (trigger, frequency, grace period, foreign associate). Flag the asset as associate-managed and confirm status directly with the foreign associate rather than computing a date the assistant does not understand.

---

## Deadline report

Default window: 90 days. Request a different window ("30 days," "180 days") if needed.

The assistant refreshes computed deadlines before producing the report. Present results grouped by urgency:

```
IP PORTFOLIO DEADLINE REPORT — [date]
[Client / Matter] — window: next [N] days

LAPSED / IN GRACE
  [Asset ID] / [Jurisdiction] / [Type] / [Mark or title]
    [Required action] — original due [date], grace ends [date]
    Status: grace / lapsed

DUE WITHIN [N] DAYS
  [Asset ID] / [Jurisdiction] / [Type] / [Mark or title]
    [Required action] — due [date]
    Basis: [e.g., "5th–6th anniversary of registration"]
    [Outside counsel / agent if applicable]

UPCOMING (beyond immediate window)
  [list]

ASSOCIATE-MANAGED
  [Asset ID] / [Jurisdiction] — managed by [agent]; confirm directly
  [Asset ID] / [Jurisdiction] — no agent recorded; confirm who is handling

UNKNOWN (cannot compute deadline)
  [Asset ID] — missing [field]; confirm and supply before relying on this report

SUMMARY
  Total assets tracked: [N]
  Deadlines in window: [N]
  Last audit: [date or not recorded]
```

Close every report with: *"Computed from portfolio data provided. Verify each deadline against USPTO TSDR / Patent Center, WIPO Madrid Monitor / Patentscope, EUIPO eSearch, or the relevant registry before filing or paying."*

---

## Adding an asset

Walk through interactively:

1. Type — trademark / patent / copyright / design / domain
2. Jurisdiction (default: US)
3. Mark, title, or domain name
4. Record owner — the exact registered entity name (matters for §8 filings and assignment records)
5. Key dates — filing date, registration/grant date, priority date, expiration date (per type)
6. Number(s) — application number and/or registration/patent number
7. Nice classes (trademarks) or claims count / entity size (patents)
8. Outside counsel or foreign associate, if any
9. IP management system docket ID, if tracked elsewhere
10. Business context — which client matter does this belong to?

After capture, compute next deadlines and present the asset record for the attorney to review. Save it in the app if they confirm it is correct.

**For jurisdictions not in the built-in list:** ask the attorney:
1. What maintenance events apply (renewals, annuities, declarations, other)?
2. What triggers the due date — filing date, registration date, grant date, anniversary of something else?
3. Is there a grace period, and at what cost?
4. Who is the foreign associate or local agent handling this?

Flag the asset as associate-managed until the rules are confirmed.

---

## Recording a filing or updating an asset

### Consequential-action gate

Before recording that a maintenance filing or fee payment was made, confirm with the attorney:

> Recording a §8 declaration, §9 renewal, patent maintenance fee payment, or international annuity as "filed" has consequences. If the record is wrong — missed due date, wrong entity size, wrong specimen of use — the deadline does not move, and the asset can still lapse. Has the attorney or foreign associate who made the filing confirmed it was submitted and accepted? If yes, proceed with recording. If not yet confirmed, do not mark the action as filed — instead, note the pending action and the source of the information, and flag for the attorney to verify against USPTO TSDR, the IP management system, or the relevant registry.

Do not record a deadline as "filed / complete" past this gate without an explicit confirmation.

### What to update

- **Filing completed:** Record the action type, filing date, and any confirmation or receipt number. Compute the next deadline in the asset's lifecycle (e.g., after a §8, the next event is the §9 renewal 10 years out).
- **Status change:** Mark an asset as abandoned, cancelled, or lapsed; clear open deadlines; note the date and reason.
- **Correction:** If dates or numbers were entered incorrectly, correct them and recompute deadlines. Note what changed and why.

Present the updated record in chat for attorney review before treating it as final.

---

## Portfolio audit

A broader health check beyond near-term deadlines. Run when the attorney asks or at least annually.

**Deadline hygiene**
- Any assets in the grace period right now? Acting now avoids lapse and eliminates the surcharge.
- Any lapsed assets not yet formally marked abandoned or cancelled? Either initiate revival (if the lapse was unintentional and revival is available) or update the record.
- Any assets with no next-deadline computed? Missing dates or an unknown jurisdiction — flag for the attorney to supply the information.

**Registration gaps**
- Trademark applications filed more than 18 months ago still pending? Flag for status check — a USPTO or foreign office action may be waiting for a response.
- Patent applications filed more than 4 years ago still pending? Flag for prosecution review.

**Use in commerce (trademarks)**
- §8 approaching on any mark where use in commerce is uncertain or unconfirmed? The §8 requires use on all goods/services in the registration; a use audit or excusable nonuse analysis is needed before filing. Do not assume use — ask.

**Ownership hygiene**
- Any assets where the record owner name may not match the current entity (e.g., after a corporate restructuring, name change, or acquisition)? Flag — may require a recordal of assignment before the maintenance filing.
- Owner name inconsistencies across assets? Surface for cleanup.

**Expiration horizon (24 months)**
- Any patents expiring within 24 months? Even without an upcoming maintenance deadline, the client may want to know for product planning, continuation strategy, or licensing decisions.

**Brand watch gap**
- Any registered marks not on a watch list? Flag as a gap for the attorney to decide whether monitoring is warranted.

Present results in the audit format and recommend prioritized actions. Every recommended action is for the attorney or foreign associate to execute — the assistant does not file anything.

```
IP PORTFOLIO AUDIT — [date]
[Client / Matter]

DEADLINE HYGIENE
  In grace: [N] — acting now avoids lapse and surcharge
  Lapsed (not marked abandoned): [N] — confirm status; revival may be available
  Missing next-deadline computation: [N] — supply dates or mark associate-managed

REGISTRATION GAPS
  TM applications pending >18 months: [list]
  Patent applications pending >4 years: [list]

USE IN COMMERCE (TM)
  §8 approaching on uncertain-use marks: [list]

OWNERSHIP
  Possible owner mismatch or name inconsistency: [list]

EXPIRATION HORIZON (24 months)
  Patents expiring: [list]

BRAND WATCH GAP
  Registered marks not on watch list: [list]

RECOMMENDED ACTIONS
  1. [highest priority — most time-sensitive]
  2. [next priority]
  ...
```

Close with: *"Audit based on data provided. Confirm status of any flagged item against the registry or IP management system of record before acting."*

---

## What this skill does not do

- **Does not file anything.** Every deadline and action surfaced is for the attorney or foreign associate to execute.
- **Does not verify against the registry.** Deadlines are computed from dates provided. The USPTO TSDR, WIPO Madrid Monitor, EUIPO eSearch, and national registries are the sources of truth for registration status.
- **Does not decide whether to renew.** Renewal is a business and legal decision — is the mark still in use, is the patent still valuable, does the domain still matter. This skill surfaces the deadline and the stakes; the attorney and client decide.
- **Does not replace a dedicated IP management system** for large portfolios. Anaqua, CPA Global, Clarivate, Alt Legal, and similar systems offer direct registry feeds, deadline automation, and annuity payment services. For multi-hundred-asset portfolios, use those systems and treat this skill as a lightweight surface layer.
- **Does not confirm that a filing was accepted.** "Filed" here means the attorney or associate reported it was submitted — not that the office accepted it. Confirm acceptance through TSDR, the IP management system, or the relevant registry.
- **Does not provide legal advice.** All outputs are working drafts for the attorney's review. The attorney owns the legal conclusion.

---

## Guardrails

- Jurisdiction is assumed to be US (North Carolina domicile for the client unless stated otherwise). Surface this assumption whenever it affects the analysis.
- Apply the firm's stated positions if provided in context. If a position is not given and a judgment call is required, use a conservative default and explicitly flag the assumption.
- Do not help paste privileged portfolio information outside the privilege circle. If the attorney asks to share a draft or record with a third party, flag the destination before proceeding.
- Before the attorney relies on any computed deadline for a filing, instruct them to verify against the USPTO TSDR / Patent Center, WIPO Madrid Monitor / Patentscope, or the relevant national registry.
- For web_search use: the assistant can search for publicly available USPTO/WIPO/EUIPO status if the attorney provides a registration number and asks for a status check — note that search results are not a substitute for official registry verification.
