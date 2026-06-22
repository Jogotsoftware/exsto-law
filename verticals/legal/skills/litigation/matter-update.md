---
slug: litigation.matter-update
name: Matter Update
practice_area: litigation
description: Capture a dated development on an active matter — status changes, procedural events, risk re-assessments, deadline shifts, and settlement authority updates — and present a structured record entry for the attorney to review and save.
when_to_use: When the attorney wants to log a new development, note a status change, record a court event or filing, revisit risk or materiality, or update any tracked field on a matter in the portfolio.
user_invocable: true
---

## Purpose

Keep the matter record current. Two minutes of structured capture — event type, date, summary, affected fields — produces a history entry the attorney can review and save, so the matter record doesn't drift.

Every output here is a draft for attorney review. Nothing here constitutes legal advice or a legal opinion. The attorney owns the legal conclusion.

---

## 1. Identify the matter

If a matter is already in your context, ground all output in it. If not, ask the attorney which matter this update concerns before proceeding.

---

## 2. Event type

Ask the attorney to categorize the event (or accept freeform if none fits):

- **Procedural** — motion filed/received, order issued, hearing held, deadline set
- **Discovery** — production made/received, depositions taken, subpoena served
- **Substantive** — new facts, key document surfaced, ruling on merits
- **Strategy** — posture shift, settlement offer made/received, authority update
- **Risk re-assessment** — severity or likelihood changed
- **Stakeholder** — new person looped in, counsel change
- **Administrative** — engagement letter executed, budget adjusted, hold refreshed

---

## 3. Date

Default to today (2026-06-22 unless the attorney specifies otherwise). Accept an override for events captured after the fact.

---

## 4. Summary

Draft a one-paragraph narrative: what happened, what it means, any immediate implication. Present it for the attorney to confirm or edit before treating it as final.

---

## 5. Affected fields

Walk through only the fields likely touched by the event type — don't prompt for all of them every time:

| Field | Prompt when |
|---|---|
| `status` | Stage may have shifted (e.g., pleadings → fact discovery) |
| `stage` | Substage needs a substage update |
| `risk` | Risk level may have changed |
| `materiality` | New facts or settlement activity (see gate below) |
| `exposure_range` | New information revises the range |
| `next_deadline` | A new upcoming date has appeared |
| `outside_counsel` | Counsel has changed |
| `internal_owners` | Someone new added or removed |
| `legal_hold` | Hold was refreshed, expanded, or released |

**Procedural events** typically touch only `stage` and `next_deadline`. **Settlement activity** typically touches `materiality`, `exposure_range`, and `status`. Use judgment.

---

## 6. Settlement-acceptance gate — required stop

If this Strategy update is a **settlement acceptance** — the firm or client is accepting an offer, executing a settlement agreement, or authorizing acceptance in principle (not merely logging an offer made or received):

> Accepting a settlement has legal consequences: it resolves claims, typically requires a release, and can affect insurance, tax, and related matters. Before logging the acceptance, confirm with the attorney of record that the decision has been reviewed. If that review has happened, say so and proceed. If not, here is a one-page brief to bring to the review:
>
> [Generate: matter name, proposed settlement terms (dollar, structure, release scope, confidentiality, non-disparagement), current exposure range, what authority is on file, key risks of accepting vs. proceeding, three questions to answer before accepting.]

Do not log the acceptance or change materiality on an acceptance basis without an explicit confirmation. Logging offers or counters does not require this gate — acceptance does.

---

## 7. Materiality check — explicit prompt for certain event types

When the event type is one of the following, always surface a materiality prompt before moving on. Do not let silence count as "no change."

| Event type | Prompt |
|---|---|
| Substantive (new facts, key document, merits ruling) | "This event is substantive. Does it affect materiality? Current: [current]. Options: reserved / disclosed / monitored / none. Change?" |
| Strategy (settlement offer made or received) | "Settlement activity can trigger materiality reclassification. Current: [current]. If the offer, counter, or acceptance moves exposure or shifts from contested to probable-and-estimable, say so." |
| Risk re-assessment | "Risk has moved. Should materiality track? Current: [current]. Reclassify?" |
| Regulatory / enforcement development | "Regulator action (subpoena, CID, enforcement notice) usually triggers a disclosure analysis. Current: [current]. Change?" |

Capture the result explicitly in the history entry:

```
Materiality check: [no change / changed from X to Y]
Reasoning: [one sentence]
```

If materiality moves to `reserved` or `disclosed` and no prior reserve or disclosure existed, flag that finance and/or the responsible partner may need to be notified per the firm's materiality thresholds.

North Carolina assumption: if no jurisdiction is specified, apply NC law defaults. Surface that assumption if it affects the materiality or disclosure analysis.

---

## 8. Linked document (optional)

If the update references a document (order, filing, correspondence), ask whether the attorney wants to note it. Not pushy — one prompt, then move on.

---

## 9. Draft history entry

Present the following for review before treating anything as final:

```
[YYYY-MM-DD] — [Event type]: [short title]

[Paragraph summary.]

Fields changed:
- [field]: [old → new]
- [field]: [old → new]

Materiality check: [result]
Reasoning: [one sentence]

Related document: [if provided]
```

If no fields changed, omit that block. If materiality was not a required check for this event type, omit that block.

Ask: "Does this look right? Any edits before you save it to the matter?"

---

## What this skill does not do

- **Correct past entries.** If a prior entry was wrong, log a new entry that references and corrects it — the record is append-only.
- **Decide materiality.** It surfaces the question and captures the attorney's answer. The attorney decides.
- **Decide whether to accept a settlement.** It gates the log on attorney confirmation and can draft a briefing memo; the decision is the attorney's.
- **Access Westlaw, CourtListener, or case-management systems directly.** If external research or docket data is needed, use web_search or documents the attorney provides, and note the limitation.
