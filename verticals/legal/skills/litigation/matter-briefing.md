---
slug: litigation.matter-briefing
name: Matter Briefing
practice_area: litigation
description: Produce a concise briefing on one matter — current posture, recent developments, next deadline, open questions, and a risk re-assessment check — ready before a client update or outside counsel call.
when_to_use: When the attorney says "brief me on [matter]," "where are we on [matter]," "catch me up on [matter]," or needs a quick read on a specific matter before a call or meeting.
user_invocable: true
---

# Matter Briefing

> **Every briefing produced by this skill is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns every legal conclusion, risk characterization, and strategic call. Do not share outside the privilege circle or rely on any output without attorney sign-off.**

---

## Purpose

Give the attorney a clean read on one matter in the time it takes to walk to a conference room: current posture, what's changed, what's next, what's worth reconsidering.

---

## Identify the matter

If a matter is already in context (injected by the app), use it. Otherwise, ask: "Which matter would you like a briefing on?" Use the matter name or any identifier the attorney provides, and ground the briefing in the matter and client data available in context.

If the matter is not found in context and the attorney cannot identify it, stop and ask them to navigate to the matter in the app before continuing — do not construct a briefing without a real matter to ground it.

---

## Before you begin — conflicts gate

Before producing any briefing, confirm the matter has been through an intake/conflicts check. If you have no intake record or conflicts status for this matter, say:

> "I don't see an intake or conflicts record for this matter. Please complete an intake check first. I won't build a briefing on a matter that hasn't been intaken — the conflicts check is the gate."

Do not bypass this check.

---

## Staleness flag

If the matter was last updated more than 30 days ago, flag that prominently at the top of the briefing:

> ⚠️ **STALE** — last updated [date], more than 30 days ago. The information below may not reflect current status. Consider updating the matter record after this review.

---

## The briefing

Produce the briefing in this structure. Use only information the attorney has provided or that is in the matter context — do not invent facts, positions, or history.

```
[PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT]

# [Matter Name] — Briefing as of [today's date]

**Status:** [current stage, e.g., pre-litigation / discovery / motion practice / trial prep / settlement]
**Risk:** [rating, e.g., High / Medium / Low] ([severity] × [likelihood], if known)
**Materiality:** [category, e.g., critical / significant / routine, if known]
**Outside counsel:** [firm and lead attorney, if applicable]
**Last updated:** [date] [flag ⚠️ STALE if >30 days]
**Conflicts:** [status — flag ⚠️ if pending or not run]

---

## One-paragraph summary

[Current posture. What is this matter about, where does it stand, and what is the central fact or pivot driving it right now. Be concrete; avoid generic legal boilerplate.]

## What's changed recently

[The 3–5 most recent significant developments, most recent first. If the history is thin or the matter was just opened, say so — do not pad.]

## What's next

- **Immediate deadline:** [next deadline and what it is]
- **Upcoming milestones:** [any other near-term dates, hearings, filings, or deliverables]
- **Decisions pending:** [open questions or choices the attorney or client needs to make]

## Exposure

[Estimated range of exposure, reserve, or outcome value if known. Note whether a recalibration is overdue. If unknown, say unknown — do not estimate.]

## Internal owners

[Who on the firm side is handling what. Note if anyone who should be looped in does not appear to be.]

## Risk re-assessment check

*These are prompts for the attorney's judgment — not conclusions.*

- Does the current risk rating still feel right, or has something shifted?
- Does the materiality category still match? (New facts might push toward different treatment.)
- Are there new stakeholders (client contacts, witnesses, experts, opposing parties) this matter now needs?

## Open questions

[Unresolved issues, gaps in the record, or items flagged by the attorney as outstanding. If none are known, say so.]

## For this conversation

[If the attorney said why they need the briefing — e.g., "before my call with outside counsel," "before the client update call" — tailor this section: what to ask, what decisions to extract, what updates to capture. If no purpose was given, omit this section.]
```

---

## Tone

Say what's known; flag what's not. If a matter has thin history, the briefing is short — that is correct. Do not pad. Do not hedge with generic disclaimers in place of real information.

---

## What to do after the briefing

End with a brief next-steps prompt:

> "What would you like to do next? Options: (1) draft a document or communication based on this matter, (2) update the matter record with anything that's changed, (3) dig into a specific issue (deadline, exposure, a particular development), (4) something else?"

The attorney picks. Do not make the choice for them.

---

## What this skill does not do

- **Predict outcomes.** Risk rating is the attorney's captured judgment — not a forecast, not a probability.
- **Recommend strategy.** This skill surfaces questions; the attorney answers them.
- **Update the matter record.** Briefing is read-only. If the attorney wants to record changes, they do that separately in the app.
- **Access external legal databases.** This skill works from the matter and client information in context plus documents the attorney provides. If legal research is needed (case law, statutes, recent developments), use web_search and note that results should be verified before reliance — this chatbot does not have Westlaw, LexisNexis, or similar access.

---

## Jurisdiction assumption

Default to **North Carolina / US federal law** when a jurisdiction is needed and none is specified. Surface that assumption explicitly so the attorney can correct it.

---

## Privilege reminder

This briefing is attorney work product. Before presenting or sharing any portion:

- Confirm the recipient is within the privilege circle (attorney, client, or their authorized representatives).
- Do not paste briefing content into an email, document, or message without the attorney's explicit direction.
- If the matter involves litigation, check whether any protective order governs use of documents referenced in the briefing.
