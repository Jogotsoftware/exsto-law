---
slug: employment.expansion-update
name: International Expansion Tracker Update
practice_area: employment
description: Resume and update an in-progress international employment expansion project — surface what is now unblocked, flag overdue items, and identify the next priorities based on what the attorney reports has happened since the last review.
when_to_use: Attorney says "update the expansion," "where are we on [country] hiring," "what's next for the expansion," "check expansion status," or reports progress on an international employment expansion in progress.
user_invocable: true
---

## Purpose

When the attorney is working through an international expansion and returns to it after work has happened, this skill helps them quickly resurface the current state, record what has moved, identify what is now unblocked, and flag anything that is overdue.

Every output is a draft for attorney review, not legal advice and not a legal opinion. The attorney owns all legal conclusions. Jurisdiction-specific employment law varies significantly — surface assumptions explicitly and flag when local counsel is needed.

If a matter and client are in context, ground all work in that matter. If no matter is in context, ask: "Which matter or expansion is this for, and which country?"

---

## Step 1 — Surface the current state

Ask the attorney to share (or paste) their current expansion tracker if one is not already in context. A tracker should capture, for each open item:

| Field | Notes |
|---|---|
| Item | What needs to happen |
| Status | `open` / `in-progress` / `done` / `blocked` |
| Owner | Who is responsible |
| Due date | Target date (if any) |
| Depends on | Other items that must close first |
| Notes | Last known status, blockers, decisions made |

If no tracker exists yet, tell the attorney: "It looks like we haven't set up an expansion tracker for this country yet. Paste in whatever notes you have and I'll help structure it, or describe where things stand and we'll build it from scratch."

Once you have the tracker, present a compact summary:

```
[Country] Expansion — last reviewed [date if known, otherwise "not yet recorded"]

Open: [N] | In progress: [N] | Done: [N] | Blocked: [N]

Next priorities (open items with earliest due dates or highest dependencies):
  • [item] — owner: [owner]
  • [item] — owner: [owner]
  • [item] — owner: [owner]
```

---

## Step 2 — Collect updates in one pass

Ask the attorney for all updates in a single prompt rather than item by item:

> Which items have moved since we last looked? Tell me what's changed — for example: "EOR decision made — going with [provider]," "outside counsel engaged in Germany," "PE analysis still open, waiting on tax." You can also add new items, change owners, or push due dates.

Do not interrogate each line of the tracker one at a time. Wait for the attorney's response, then apply all changes at once.

---

## Step 3 — Apply updates and recalculate unblocked items

After the attorney reports what has changed:

1. Update the status of each reported item (`open` → `in-progress` → `done`, or `blocked`).
2. For any item newly marked `done`, check the dependency column — identify any items that were waiting on it and flag them as now actionable:

   > Now unblocked: [item] — previously waiting on [completed item]. Owner: [owner].

3. Flag any item whose due date has passed and is still `open` or `in-progress`:

   > ⚠️ Overdue: [item] — was due [date], owner: [owner]. Flag for attorney attention.

---

## Step 4 — Present the updated tracker and next steps

Return the full updated tracker in the same table format, then close with:

```
Update summary: [N] items closed, [N] still open, [N] newly unblocked, [N] overdue.

Next priority: [top open item with earliest due date or highest dependency weight].
```

Present the updated tracker in chat for the attorney to review and save in the app if they choose.

---

## Jurisdiction and employment-law guardrails

International expansion involves employment law that varies significantly by country. Apply these defaults:

- **Employer of Record (EOR) vs. entity**: Do not recommend one over the other without knowing the attorney's position and the specific country's rules. If the attorney has not stated a preference, ask: "Is the plan to hire through an EOR, a local entity, or is that still open?" Flag this as a decision that requires local employment counsel input.
- **Permanent establishment (PE) risk**: Flag any item involving a local "employee" who is actually a contractor, or any individual working in-country for an extended period, as a potential PE trigger. Note that the analysis is country-specific and requires local tax and employment counsel. Do not render a PE conclusion.
- **Data privacy**: Flag any item involving employee data transfers (offer letters, background checks, payroll) as requiring review under the applicable data-protection regime (e.g., GDPR for EU/EEA countries). Do not render a data-privacy conclusion.
- **Local mandatory benefits and notice periods**: Do not invent country-specific minimums. If the attorney asks "what's required in [country]?" use web_search to surface publicly available information, clearly label it as general information requiring local counsel verification, and do not treat it as authoritative.
- **Outside counsel**: Flag any item that requires a filing, registration, works council notification, or statutory approval as needing local counsel engagement. Prompt the attorney if that item does not already have an outside counsel owner assigned.

**Default jurisdiction assumption**: Unless the attorney specifies otherwise, assume the home entity is US-based and that US employment law governs the parent company's obligations. Flag this assumption explicitly.

---

## What to present vs. what to ask

- If the attorney provides the tracker and updates: proceed through all steps and present the full updated state in chat.
- If a firm position (e.g., preferred EOR provider, standard notice-period floor, PE-risk threshold) is provided in context: apply it. If not provided and it is relevant to an open item, ask one short question or note the gap as "attorney decision pending" and flag it in the tracker.
- Do not invent firm positions, preferred vendors, or legal conclusions as if they were established. Every assumption you make must be explicitly labeled as an assumption.

---

## Output format

Always return:
1. The compact status summary (Step 1 format).
2. The full updated tracker table.
3. The update summary line and next priority.
4. Any overdue flags and newly unblocked items, inline.
5. Any jurisdiction or legal flags that surfaced during the update, clearly separated.

All output is for attorney review only. Nothing in this output constitutes legal advice or a legal opinion. The attorney must verify all country-specific requirements with qualified local counsel before relying on any item.
