---
slug: regulatory.comments
name: Notice of Proposed Rulemaking Comment Period Tracker
practice_area: regulatory
description: Surface open NPRM comment periods, track deadlines, and record filing/not-filing/waived decisions for matters or clients with regulatory exposure.
when_to_use: When the attorney asks about an open rulemaking comment window, wants to decide whether to file a comment, needs a deadline summary for pending NPRMs, or wants to log a filing or not-filing decision.
user_invocable: true
---

## Purpose

NPRM comment deadlines disappear without warning. This skill helps you surface open comment periods, evaluate whether filing makes sense for a given client or matter, and record your decision so nothing falls through.

The decision to file — or not — is always yours as the attorney. This skill organizes the information and flags the risks; it does not make the call or produce a submission-ready comment letter.

---

## Default view — open comment periods

When the attorney asks you to show or check comment periods, present a summary in this format (populated from any NPRMs mentioned in context, provided by the attorney, or surfaced via web_search):

```
## Comment Period Tracker — [date]

### Deadline in <14 days

| ID | Regulation | Docket | Deadline | Days left | Decision | Owner |
|---|---|---|---|---|---|---|
| CMT-001 | [name] | [docket #] | [date] | [N] | Undecided | [attorney/client] |

### Open (>14 days)

[same table]

### Recently decided

| ID | Regulation | Decision | Rationale |
|---|---|---|---|
| CMT-002 | [name] | Not filing | [reason] |

---
**Total open:** [N]   **Undecided with deadline <30 days:** [N]
```

If no NPRMs are currently in context, ask the attorney which agency, docket, or subject area to check, then use web_search to look up open comment periods on regulations.gov or the relevant agency site.

---

## Tracking a new NPRM

When the attorney surfaces a new NPRM, capture:

- **ID** — assign a short local ID (CMT-001, CMT-002, …) or use the docket number
- **Regulation name and agency**
- **Docket number**
- **Comment deadline** (confirm from the Federal Register notice or agency site — do not infer)
- **Sections most relevant to the client's business**
- **Decision owner** (default: the supervising attorney)
- **Status** — Undecided / Filing / Not filing / Waived

Present this as a structured block in chat. The attorney can copy it into the matter notes or save it in the app.

---

## Logging a decision

When the attorney is ready to record a decision on a tracked NPRM:

Ask for:
1. **Decision** — filing / not filing / waived
2. **Rationale** — brief reason (e.g., "Rule doesn't apply to our operating model" or "Filing comment on Section 3 re: definition of 'covered entity'")

If the decision is **filing**, also flag:
- Internal review deadline — comment deadline minus 5 business days
- Who drafts the comment
- Whether to file jointly through a trade association (and whether that affects the client's public position)

Present the logged entry in chat for the attorney to save in the matter record.

If the decision is **not filing or waived**, no further gates apply — record the rationale and move on.

---

## Before producing a draft comment or recording a "filing" decision

**This gate applies every time** — before drafting a comment letter for submission or locking in a filing decision:

Submitting a public comment to a regulator is a consequential act. The comment is a public record, it states the client's legal position, and positions taken here can be used against the client in subsequent proceedings or enforcement matters. Confirm before proceeding:

- Has the client been advised that filing a comment creates a public record of their position?
- Are there any prior comments, public statements, or trade-association filings that could create inconsistency?
- Should this be filed individually, jointly with a trade group, or not at all?
- Are there sections where the client should remain silent (adverse-admission risk, ongoing litigation, unresolved internal compliance gaps)?

If the answer to any of these is unclear, flag it explicitly and ask the attorney before producing submission-ready language.

For **business clients without in-house counsel** (non-lawyer contact): surface this brief before producing a draft:

> Submitting a comment to a regulator is a public, on-the-record statement of your company's legal and policy position. It can be used against you in enforcement proceedings, litigation, or future rulemakings. Before I draft anything for submission, please confirm you've reviewed this with an attorney. I can prepare a brief for that conversation covering: (1) what the proposed rule says and what sections affect your business, (2) what a comment would say, (3) the risks of filing — and of not filing, (4) whether to file individually or through a trade association. Let me know how you'd like to proceed.

Do not produce a submission-ready draft past this gate without an explicit go-ahead from the attorney.

---

## Researching an NPRM

When the attorney asks you to summarize or analyze an open rulemaking:

1. Use web_search to locate the Federal Register notice (regulations.gov, agency site, or FR.gov).
2. Identify: agency, docket number, comment deadline, summary of proposed rule, affected parties, key sections.
3. Summarize the proposal in plain language, then note which sections are most likely to affect the client's business based on what you know about the matter.
4. Flag: (a) any short deadline, (b) any prior client positions that may be relevant, (c) whether a trade association the client belongs to is known to be filing.

**Jurisdiction note:** Default to federal US rulemaking (regulations.gov / Federal Register). For state-level comment periods in North Carolina, check the NC Register (ncleg.gov / OSBM). Surface whichever jurisdiction is relevant and flag the assumption if it's not clear from context.

**Limits:** This assistant does not have access to Westlaw, Bloomberg Law, or regulatory monitoring services. Research relies on web_search and documents the attorney provides. For comprehensive regulatory monitoring, the attorney should maintain a subscription service or docket-alert system in parallel.

---

## What this skill does not do

- **Draft the comment letter.** That is a separate attorney task — ask to shift into drafting mode when the decision to file is confirmed.
- **Make the filing decision.** It tracks the decision; the attorney makes it.
- **Monitor post-comment activity or rulemaking progress.** Once a comment is filed, ask the attorney whether to track the docket for a final rule.
- **Replace a regulatory monitoring service.** web_search covers publicly visible deadlines; it does not catch every agency notice the day it drops.

---

> Every output from this skill is a draft for attorney review, not legal advice. The attorney owns the legal conclusion — including whether to file, what positions to take, and whether a given rule applies to the client's business. Do not treat any output as a final work product until the attorney has reviewed and approved it.
