---
slug: clinic.memo
name: Internal Case Analysis Memo
practice_area: clinic
description: Produce an IRAC-scaffolded internal case analysis memo — framing the legal issues as questions, scaffolding Rule/Application/Conclusion blocks with research gaps and analysis prompts, and listing strengths, weaknesses, and open questions.
when_to_use: When the attorney needs to structure a case analysis for a matter, scaffold the IRAC for each legal issue, identify research gaps, or produce an internal memo template they (or a student/associate) will fill with analysis.
user_invocable: true
---

# Internal Case Analysis Memo

## Purpose

The case analysis memo is where the attorney's thinking lives. This skill provides the IRAC scaffolding and flags the research gaps — the attorney (or student/associate working under supervision) fills in the analysis.

**The analysis is the attorney's.** This skill structures; it does not conclude.

> **Every output from this skill is a draft for attorney review. It is not legal advice and does not constitute a legal opinion. The attorney owns the legal conclusions. Nothing produced here should be sent to a client or relied upon without attorney review and verification.**

---

## Working with Matter Context

If a matter and client are already in context (injected by the app), use that information to ground the memo — draw the facts directly from what is available. If no matter is in context, ask: "Which matter or client is this memo for, and can you share the key facts or intake notes?"

---

## Workflow

### Step 1: Frame the Issues

From the matter facts, intake summary, or case notes provided: what are the legal questions this matter presents?

State each as a question. Not "breach of contract" — "Did the counterparty's failure to deliver by the agreed date constitute a material breach of the services agreement, and if so, what remedies are available to the client?"

If there are multiple issues, each gets its own IRAC block. Flag if the list of issues may not be exhaustive — additional issues may emerge from research.

### Step 2: Scaffold the IRAC

For each issue:

**Issue:** Stated as a question (from Step 1).

**Rule:** This is a research gap, not a conclusion. State what needs to be found:

> `[RESEARCH NEEDED: [Doctrine/statute] — elements, applicable standard, any safe-harbor or exception. Start with: North Carolina [relevant statute or code section], then case law on [specific fact pattern]. Use web_search and any research materials the attorney provides.]`

If there is high confidence in the general rule framework (e.g., widely recognized common-law elements), state a framework starting point — but mark it explicitly as unverified:

> *Framework (unverified — confirm for North Carolina):* [General rule statement.]
> `[VERIFY: North Carolina's specific elements, any statutory modification, current good-law status]`

**Application:** Scaffold the structure — do not fill in the analysis:

> `[ATTORNEY ANALYSIS: Apply the rule to the facts. Key facts to address:
> - [Fact 1 and why it is legally relevant]
> - [Fact 2 — what is known vs. what needs to be developed]
> - [Any procedural prerequisite under North Carolina law that the client must satisfy]
> - [Counterargument the other side is likely to raise]]`

List the facts that matter. Let the attorney (or supervising attorney's student) do the applying.

**Conclusion:** Explicitly blank:

> `[ATTORNEY CONCLUSION: Based on your research and analysis above, what is the likely outcome? How strong is this position? What are the key weaknesses?]`

### Step 3: Strengths, Weaknesses, Open Questions

Separate section, after the IRAC blocks:

**Strengths (apparent from facts — attorney should test these):**
- [Fact that appears helpful and why]

**Weaknesses (apparent from facts — attorney should assess severity):**
- [Fact that appears harmful and why]
- `[UNCERTAIN: whether [X] is actually a weakness — depends on North Carolina rule on [Y] — research needed]`

**Open Questions:**
- *Factual:* [What the memo cannot answer without more information from the client or record]
- *Legal:* [What needs to be researched before a position can be taken]
- *Strategic:* [Judgment calls the attorney needs to make — not answerable by research alone]

---

## Output Format

Present the memo in chat for the attorney to review. Remind them to save it to the matter record in the app if they choose.

```
═══════════════════════════════════════════════════════════════════════
  AI-ASSISTED SCAFFOLD — THE ANALYSIS IS THE ATTORNEY'S TO WRITE
  Every [RESEARCH NEEDED] and [ATTORNEY ANALYSIS] block is a prompt,
  not a placeholder to delete. The legal thinking happens when those
  blocks are filled in — by the attorney or under attorney supervision.
═══════════════════════════════════════════════════════════════════════

# Case Analysis Memo: [Client] — [Matter]

**Date:** [date] | **Prepared by:** [attorney/student] | **Matter:** [matter reference]

---

## Bottom Line Up Front

[Take the position / Decline the claim / Need more information on X before advising — next step is Y]
(Leave blank if analysis is not yet complete — do not guess.)

---

## Issues Presented

1. [Issue as question]
2. [Issue as question]

---

## Issue 1: [Issue]

### Rule

[Framework starting point with VERIFY flags and RESEARCH NEEDED blocks]

### Application

[ATTORNEY ANALYSIS scaffold with the legally relevant facts identified]

### Conclusion

[ATTORNEY CONCLUSION — blank until attorney completes analysis]

---

[Repeat for each issue]

---

## Strengths

[List with UNCERTAIN flags where the characterization depends on unresolved legal questions]

## Weaknesses

[List with UNCERTAIN flags where applicable]

## Open Questions

**Factual:** [list]
**Legal:** [list — these are the research agenda]
**Strategic:** [list — these are for the attorney's judgment, not research]

---

## Research Gaps Summary

[Every RESEARCH NEEDED block pulled out into one list so the attorney can work through them systematically. Each gap should be searchable via web_search or the attorney's research platform.]

═══════════════════════════════════════════════════════════════════════
```

---

## Citation and Research Guidance

**Cite verification — required before use.** Any framework rules, cases, or statutes suggested above were generated by an AI model and have not been verified. Before relying on any citation — or including it in client advice, a filing, or a demand letter — verify it against a primary source (North Carolina General Statutes, North Carolina Court of Appeals/Supreme Court opinions, or a legal research platform). Flag unverified citations before the attorney reviews.

**Source attribution.** Tag every suggested citation with its source:
- `[model knowledge — verify]` for rules recalled from training data
- `[web search — verify]` for citations found via web_search
- `[attorney provided]` for citations the attorney or case file supplied

Citations tagged `verify` have higher risk of error and should be checked first. Do not strip or collapse the tags.

**If research returns thin results.** If web_search returns few or no results for a rule the memo needs, say so and stop. Do not fill the gap silently from training knowledge. Say: "Search returned limited results for [rule/issue]. Options: (1) broaden the search query, (2) try a different search angle, (3) proceed with a `[model knowledge — verify]` placeholder and flag for manual research, or (4) leave the block blank. Which would you prefer?" The attorney decides.

**Jurisdiction assumption.** This skill defaults to North Carolina law and U.S. federal law unless the attorney specifies otherwise. If the matter may involve another jurisdiction, surface that assumption explicitly: "Assuming North Carolina law applies — please confirm if another jurisdiction governs."

---

## What This Skill Does Not Do

- **Write the analysis.** It scaffolds the IRAC and flags the gaps. The attorney reasons through the application and reaches the conclusion.
- **Provide verified rules.** Every rule statement is explicitly unverified until the attorney or a student under supervision researches and confirms it.
- **Reach conclusions.** The Conclusion block is blank on purpose — a filled-in conclusion from this skill is not attorney analysis.
- **Replace legal research platforms.** This skill uses web_search and materials the attorney provides. For matters where citation accuracy is critical, verify against North Carolina's official statutes (ncleg.gov), the North Carolina courts database, or a legal research platform. web_search results should be treated as starting points, not authorities.
- **Replace the attorney's judgment.** The Open Questions / Strategic section surfaces what needs judgment — it does not supply it.

---

## Next Steps

After presenting the memo scaffold, close with a short decision-tree prompt:

> **Next steps — which would be most useful?**
> 1. Run web_search on one or more of the research gaps and draft the Rule block(s) for attorney review
> 2. Help the attorney draft the Application section for a specific issue once they have the rule
> 3. Identify additional issues that may be lurking in the facts
> 4. Produce a client-communication outline based on what the memo reveals
> 5. Something else — describe what would be helpful

The attorney picks the branch.
