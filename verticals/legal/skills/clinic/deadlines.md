---
slug: clinic.deadlines
name: Deadline Tracking and Rollup
practice_area: clinic
description: Track, triage, and report case deadlines across all active matters — add new deadlines, get a cross-matter rollup, update or complete existing entries, and flag overdue items until resolved.
when_to_use: When the attorney asks to add a deadline, check what is due this week, get a deadline report across matters, update a deadline date or assignment, mark a deadline done, or close one that no longer applies.
user_invocable: true
---

## Purpose

A practice's biggest operational risk is a missed deadline. Deadlines that exist only in memory get dropped at handoff, get forgotten under a busy week, or get missed when priorities shift. This skill is the central operational record for deadline tracking.

The attorney is on the hook if a deadline is missed. Warnings fire early. Overdue items stay visible until explicitly resolved.

> **Every output is a draft for attorney review, not legal advice.** Deadline calculations must be confirmed against the governing rule — statute, court order, local rule, or contract — before being relied on. The attorney owns the legal conclusion, including whether a deadline applies, when it runs from, and how computation-of-time rules affect it.

---

## Jurisdiction assumption

Default jurisdiction: **North Carolina / United States federal** where applicable.

Deadlines, tolling rules, computation-of-time rules, and local court practices vary materially by jurisdiction and by specific court. If a matter involves a different state, a specific court's local rules, or a federal-vs.-state forum question, surface the assumption explicitly and confirm the deadline against the governing rule before relying on it.

---

## Modes

Choose the mode that matches the attorney's request. If none is specified, default to **Report**.

---

### Add — log a new deadline

**Collect these fields:**

| Field | Notes |
|---|---|
| Matter | Which matter/client this deadline belongs to. If a matter is already in context, use it; otherwise ask. |
| Practice area | (litigation / transactional / regulatory / other) |
| Type | filing / hearing / statute-of-limitations / discovery / cure-period / response / notice / other |
| Description | One line — what exactly is due |
| Due date | Date (and time + timezone if the deadline has a clock component) |
| Source | Where the deadline comes from — e.g., "NCRCP 12(a)(1)," "court order entered 2026-06-01," "contract §7 cure period" |
| Owner | Who is responsible for completing this item |

Generate a short ID slug automatically: `[matter-short]-[type]-[YYYY-MM]` (e.g., `smith-filing-2026-07`).

**Duplicate check:** if a deadline for the same matter + type + due date already appears to exist, flag it and ask before adding.

**Plausibility sanity check (scaffolding, not computation):**

After a due date is supplied, apply a rough reasonableness check against typical ranges for that deadline type in North Carolina / the applicable jurisdiction — the goal is to catch gross input errors, not to do the attorney's math.

- If the date falls within the typical range for that type, proceed without comment.
- If the date falls well outside the typical range, pause and flag it:

  > The date you entered looks unusual for a [type] deadline — [filing type] deadlines in [jurisdiction] typically fall within [rough range] of [triggering event]. Your entry is [date], which is [N] days from [triggering event]. Re-check your calculation against the governing rule and the applicable computation-of-time rule. If your calculation is correct (e.g., local rule exception, tolling, waiver, atypical triggering event), confirm and I will log it. Otherwise, recompute and re-enter.

- If no typical range is known for this type of deadline, log the entry and note that no plausibility check was applied.
- If the jurisdiction's typical ranges are unfamiliar, log the entry and note that plausibility checks are not available for this jurisdiction — treat the date as unverified.

**The assistant does not compute deadlines.** If the due date is not yet calculated, log the entry with `due: [VERIFY]` and note that computation is needed. The calculation stays with the attorney, confirmed against the governing rule.

**Surfacing deadlines from context:** if another conversation turn surfaces a deadline (intake summary, draft review, status check), offer to log it here with pre-populated fields for the attorney to confirm.

**Confirm before logging.** Present the complete entry and ask the attorney to confirm before recording it.

Present the confirmed entry in chat for the attorney to save in the app if they choose.

---

### Report — cross-matter rollup

If a matter is in context, scope to that matter by default; offer to expand to all active matters if the attorney wants a full view. If no matter is in context, report across all active matters.

Present the report in this format:

```
# Deadline Report — [today's date]

Active deadlines: [N]
Overdue: [N]
Due this week (next 7 days): [N]

---

## OVERDUE (flagged for immediate attention)

| ID | Matter | Type | Due | Owner | Days overdue |
|---|---|---|---|---|---|

## Due today / next 3 days

| ID | Matter | Type | Due | Owner |
|---|---|---|---|---|

## Due in 4–7 days

| ID | Matter | Type | Due | Owner |
|---|---|---|---|---|

## Due in 8–14 days

[list]

## Beyond 14 days

[count only — ask to expand the horizon if you want details]

---

## By owner (workload distribution)

| Owner | Overdue | Next 7d | Next 14d | Total active |
|---|---|---|---|---|

## By practice area

[same table, grouped by area]

## Unassigned deadlines

[list any active deadline with no assigned owner]
```

**Warning thresholds:** 14 / 7 / 3 / 1 days (default). If the firm has configured different thresholds in context or firm settings, use those instead.

**Overdue items do not auto-resolve.** An overdue deadline stays flagged in every report until the attorney explicitly marks it complete or closes it with a rationale.

---

### Update — modify an existing deadline

Common updates: due date changed (continuance, amended order, contract amendment), owner changed (reassignment), notes added.

Identify the deadline by its ID or by matter + type + approximate date. Present the proposed change and ask the attorney to confirm before applying. Note the update with today's date and the reason in the entry's history.

Present the updated entry in chat for the attorney to save.

---

### Complete — mark a deadline done

Set status to completed with today's date. Confirm with the attorney that the underlying work is actually filed, served, submitted, or otherwise done — not just that the date has passed. Completed items drop off active reports but remain in the matter record.

---

### Close — close without completing

For deadlines that no longer apply: matter settled, motion withdrawn, client ended the engagement, deadline superseded by a new order. Require a rationale note explaining why. Closed items drop off active reports but remain in the matter record.

---

## What this skill does not do

- **Calculate deadlines from triggering events.** The attorney or their staff does the math using the governing rule. This skill logs the result and sanity-checks it — it does not own the computation.
- **File or serve anything.** This skill tracks dates. Actual filing happens outside this assistant.
- **Auto-notify or run on a schedule.** This is an on-demand skill. When the attorney asks for a deadline check or report, produce it. There is no background monitoring.
- **Override or interpret local rules.** If a logged date contradicts what a local rule actually requires, this skill will not catch that. Calendar with `[VERIFY: confirm against local rule]` for any non-routine deadline until the attorney has confirmed the calculation.
- **Access Westlaw, CourtListener, or court docketing systems.** If a deadline needs to be confirmed against a court's docket or a statute's full text, use web search and any documents the attorney provides, and note the limitation if authoritative confirmation requires a subscription source.

---

## Integration with other turns

- **Intake summaries:** if an intake turn surfaces a hearing date, filing window, or statute-of-limitations concern, offer to log it immediately.
- **Draft review:** if a draft references a response window or deadline, offer to log it.
- **Status checks:** include upcoming and overdue deadlines when the attorney asks for a matter status summary.
- **Matter handoff:** when a matter is handed off or reassigned, surface all open deadlines for the attorney's review.
