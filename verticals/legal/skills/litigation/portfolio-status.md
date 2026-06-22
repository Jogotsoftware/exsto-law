---
slug: litigation.portfolio-status
name: Litigation Portfolio Status
practice_area: litigation
description: Roll up all active matters into a single scannable view — risk distribution, upcoming deadlines, stale matters, exposure totals, stage distribution, and flagged anomalies.
when_to_use: When the attorney asks "where do we stand," "how many open matters do I have," "what needs attention," or wants a cross-matter portfolio rollup or status snapshot.
user_invocable: true
---

# Litigation Portfolio Status

> **Every rollup produced by this skill is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns every risk characterization, prioritization call, and strategic conclusion. Do not share outside the privilege circle or rely on any output without attorney sign-off. Exposure figures are rough midpoints, not valuations.**

---

## Purpose

One read that answers: what do I own right now, what needs attention, and what's slipping? Designed for a three-minute scan before a check-in, an end-of-week review, or any moment where the attorney needs the full picture.

---

## Identify your matter set

When the attorney asks for a portfolio status, ground the rollup in the matter and client data available in context. If matters are injected by the app, use them. If they are not, ask:

> "I don't see your active matter list in context. Can you navigate to the portfolio view in the app, or paste a summary of your open matters here so I can run the rollup?"

Do not fabricate matters, facts, or history. Work only from what the attorney provides or what is in context.

If the attorney wants to include closed matters, they should say so — otherwise default to active matters only.

---

## Filters the attorney can request

- **All matters** (including closed) — "include closed" or "show all"
- **By risk tier** — "show me high-risk only" / "critical only"
- **Stale only** — "show what I haven't touched in over 30 days"
- **By matter type** — "employment matters only," "contract disputes only," etc.

Apply the requested filter before producing the rollup.

---

## The rollup

Produce the rollup in this structure. Fill every section from matter/client context or attorney-provided information. Where data is absent, say so — do not estimate or fill in.

```
[PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT]

# Portfolio Status — [today's date]

**Active matters:** [N]
**Closed (year-to-date):** [N — include only if closed matters were requested]

---

## By risk tier

| Risk | Count | Matters |
|---|---|---|
| Critical | [N] | [matter names/slugs] |
| High | [N] | [matter names/slugs] |
| Medium | [N] | [count only — ask if you want the list] |
| Low | [N] | [count only] |

## Upcoming deadlines

| Window | Matter — Deadline — What it is |
|---|---|
| Next 14 days | [...] |
| 15–30 days | [...] |
| 31–60 days | [...] |

*Overdue deadlines are flagged separately in Anomalies below.*

## Exposure

| Category | Count | Total estimated exposure (midpoints) |
|---|---|---|
| Reserved | [N] | [$X — rough midpoints only] |
| Disclosed | [N] | [$X] |
| Monitored | [N] | — |
| None / not applicable | [N] | — |

> These figures are rough estimates based on what the attorney has recorded. They are not valuations and should not be treated as such.

## By stage

| Stage | Count |
|---|---|
| Pre-litigation / threatened | [N] |
| Pleadings | [N] |
| Discovery | [N] |
| Dispositive motions | [N] |
| Trial prep | [N] |
| Settlement | [N] |
| Appeal | [N] |
| Other | [N] |

---

## Anomalies and flags

Work through each check below against the matters in context. List only items that actually trigger — do not produce empty anomaly categories.

- **Overdue deadlines:** matters whose next deadline has already passed and are still active
- **Stale (>30 days, no update):** active matters with no recorded update in over 30 days
- **Conflicts unresolved:** matters where no conflicts check has been completed or the check is still pending
- **Conflicts bypassed (override active):** matters where a conflicts override is noted — flag these permanently until the attorney clears them
- **High/critical risk without outside counsel assigned:** matters at high or critical risk with no outside counsel on record
- **Stale reserve (>60 days):** matters with reserved exposure and no update in over 60 days — reserve recalibration is likely overdue
- **Legal hold gap:** matters at the threatened, active, discovery, trial, or appeal stage with no legal hold issued — preservation duty attaches at reasonable anticipation of litigation, so threatened matters are in scope
- **Missing required fields:** matters where risk, status, opened date, or conflicts status is not recorded

---

## Closing observation

If something truly stands out in the rollup — a concentration of overdue deadlines, a critical matter without outside counsel, a stale reserve cluster — note it in one or two plain sentences. Do not produce boilerplate if nothing stands out.
```

---

## Anomaly rules (reference)

Apply these checks mechanically against what is in context:

1. **Overdue deadline** — next deadline date has passed and matter is not closed
2. **Stale** — last updated more than 30 days ago and matter is not closed
3. **Conflicts unresolved** — conflicts status is pending, not run, or absent and matter is not closed
4. **Conflicts override active** — a conflicts override or bypass is noted (never auto-clears; flag every time)
5. **High-risk uncovered** — risk is high or critical and no outside counsel is assigned
6. **Stale reserve** — matter has reserved exposure and has not been updated in more than 60 days
7. **Legal hold gap** — matter is in a litigation-adjacent stage (threatened, active, discovery, trial prep, appeal) and no hold has been issued
8. **Missing fields** — risk, materiality, status, opened date, or conflicts status is absent

---

## After the rollup

End with a short next-steps prompt:

> "What would you like to do next? Options: (1) dig into a specific matter from the rollup, (2) draft a communication or document tied to a flagged matter, (3) update a matter record with anything that's changed, (4) filter the view differently (by risk tier, stage, or stale-only), (5) something else?"

The attorney picks. Do not make the choice for them.

---

## What this skill does not do

- **Make decisions.** It surfaces what needs attention; the attorney decides priority and next action.
- **Pretend precision it does not have.** Exposure midpoints are rough and labeled as such. Do not upgrade their precision.
- **Replace a proper matter management system.** This is a working-memory rollup from data the attorney has recorded in the app. It is not a system of record.
- **Access external legal databases.** If legal research on a flagged matter is needed, use web_search and note that results must be verified before reliance — this assistant does not have Westlaw, LexisNexis, CourtListener, or similar access.

---

## Jurisdiction assumption

Default to **North Carolina / US federal law** when a jurisdiction is needed and none is specified. Surface that assumption explicitly so the attorney can correct it.

---

## Privilege reminder

This rollup is attorney work product. Before sharing any portion:

- Confirm the recipient is within the privilege circle (attorney, client, or their authorized representatives).
- Do not paste rollup content into an email, document, or message without the attorney's explicit direction.
- If any flagged matter is in active litigation, check whether a protective order governs use of documents referenced in this rollup.
