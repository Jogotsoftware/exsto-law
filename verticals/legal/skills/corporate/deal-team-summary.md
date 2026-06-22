---
slug: corporate.deal-team-summary
name: Deal Team Summary
practice_area: corporate
description: Compress diligence findings into an audience-calibrated deal team briefing — exec summary, deal-lead summary, or full working-team detail.
when_to_use: When the attorney says "brief the deal team," "summarize findings for [audience]," "what's the state of diligence," "deal update," or asks for a diligence status report for a specific audience tier.
user_invocable: true
---

## Purpose

The deal lead doesn't read 200 findings. They read: what's material, what changed since the last brief, what needs a decision. This skill compresses diligence output to the right level for the reader.

> **Every output produced by this skill is a draft for attorney review — it is not legal advice and not a legal opinion. The attorney owns every legal conclusion and every distribution decision. Do not send or file any output from this skill without attorney review and sign-off.**

> **Privilege notice:** This brief aggregates privileged diligence findings and inherits the privilege and confidentiality status of its sources. Distribution beyond the privilege circle — including to broader business teams — can waive privilege. Before presenting or forwarding the brief, confirm the distribution list matches the privilege circle.

---

## Matter context

If a matter or client is in your context, ground the brief in that matter. If no matter is in context, ask the attorney: "Which matter is this brief for?" before proceeding.

Apply any briefing preferences, deal-team composition, or audience notes the attorney has provided in the current conversation or matter context. If a preference is not stated, use the conservative defaults below and flag each assumption explicitly.

---

## Step 1 — Identify the audience tier

Ask if not clear from the prompt. Default tiers:

| Audience | Gets | Does not get |
|---|---|---|
| **Board / exec sponsor** | Top 3–5 material issues, price/structure impact, decision items | Category detail, green findings, process |
| **Deal lead** | All reds, all yellows, progress, decision items, next steps | Green finding detail |
| **Working team** | Everything — full findings, status by category, gaps | Nothing withheld |

---

## Step 2 — Load findings

Use the diligence findings the attorney has shared in chat, pasted into the conversation, or attached as documents. If findings were produced earlier in this conversation (e.g., via a diligence-issue-extraction step), reference those directly.

If no findings are available yet, ask the attorney to share them before proceeding.

Do not use web_search to locate deal-specific findings — those are privileged matter documents that must come from the attorney.

---

## Step 3 — Produce the brief for the requested tier

### Exec tier output

```
[PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION]
[DRAFT FOR ATTORNEY REVIEW — NOT FOR DISTRIBUTION WITHOUT ATTORNEY APPROVAL]

# [Deal name / code] — Diligence Brief — [date]

**Status:** [On track / Issues identified / Material findings]
**Coverage:** [X]% of available materials reviewed

## Material findings

[3–5 findings maximum. One paragraph each: what it is, why it matters to the
deal, what is being done about it.]

## Decisions needed

- [ ] [Specific decision — price adjustment, indemnity ask, walk-away trigger]
      — [who decides] — [by when]

## Since last brief

[What changed: new findings, findings resolved, coverage progress. If this is
the first brief, state that.]

---
*Draft prepared for [attorney name] review. Distribution restricted to the
privilege circle. Attorney must confirm distribution list before sending.*
```

### Deal lead tier output

Same header and material-findings / decisions-needed / since-last-brief sections as the exec tier, plus:

```
## All open issues by category

### Red
[Finding title + one-line summary — full detail below or on request]

### Yellow
[same]

## Progress by category

| Category | Materials reviewed | Coverage | Reds | Yellows | Status |
|---|---|---|---|---|---|
| [name] | [N of M] | [%] | [N] | [N] | [Complete / In progress / Blocked] |

## Gaps and outstanding follow-ups

- [Supplemental document requests outstanding]
- [Management questions not yet answered]

## Next 72 hours

[What is being reviewed, what briefings are scheduled, what decisions are
expected to land]
```

### Working team tier output

Same structure as the deal lead tier, but every finding gets its full detail block (not just a one-liner). Include finding title, category, severity, description, deal impact, and current status/owner for each item.

---

## Deltas (recurring briefs)

If the attorney indicates this is a recurring brief and shares prior findings or a prior brief in chat, lead with movement:

- New findings since the last brief
- Findings upgraded or downgraded in severity
- Findings resolved (consent obtained, issue clarified away, risk accepted)
- Coverage movement (percentage reviewed, categories completed)

Deal leads care more about movement than state. "Still 12 yellows" is less useful than "2 new yellows, 3 resolved, coverage moved from 60% to 75%."

---

## Handoffs

- **From diligence extraction:** This skill reads findings produced by a prior diligence-issue-extraction step. If the attorney ran that step earlier in the conversation, reference those findings directly.
- **To closing checklist:** Any "decision needed" items that resolve into closing conditions should be flagged for the closing checklist skill.

---

## Close with a next-steps decision tree

End every brief with a short decision tree tailored to what was just produced. Offer branches such as:

1. Draft the exec brief for distribution (attorney reviews distribution list first)
2. Expand a specific finding category to full working-team detail
3. Draft the supplemental document request for outstanding gaps
4. Flag a specific finding for escalation or walk-away analysis
5. Something else — attorney directs

The attorney picks the branch. Do not proceed to the next step without the attorney's direction.

---

## What this skill does not do

- It does not make the materiality call — it reports calls made at the extraction stage.
- It does not decide what the deal team does about a finding — it surfaces the decision for the attorney and deal lead.
- It does not distribute the brief — it drafts; the attorney sends.
- It does not access Westlaw, VDR platforms, iManage, Ironclad, or other external deal tools. All findings must be provided by the attorney in chat. If you need to look up general legal background on an issue type (not deal-specific facts), use web_search and clearly label what came from search versus what came from matter materials.

---

## Jurisdiction assumption

Where jurisdiction matters (e.g., governing law for reps, indemnity standards, regulatory thresholds), default to North Carolina / United States law unless the attorney specifies otherwise. Surface this assumption explicitly in the brief so the attorney can correct it.
