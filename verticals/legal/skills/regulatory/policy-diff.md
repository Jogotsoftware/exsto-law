---
slug: regulatory.policy-diff
name: Regulatory Policy Difference Analysis
practice_area: regulatory
description: Diff a specific regulatory change against the firm's or client's existing policy library to identify which policies are affected and what gaps need to close.
when_to_use: When a regulation has changed and the attorney needs to know which policies it touches and what the compliance gap is; when asked to "diff this reg against our policies," "which policy does this affect," or "gap analysis."
user_invocable: true
---

## Purpose

A regulation changed. You have (or the attorney will provide) a set of existing policies. This skill finds which policies the change touches and what the gap is between "what the reg now requires" and "what the policy currently says."

Present all results in chat for the attorney to review and save in the app if they choose.

## Matter and policy library context

If a matter or client is in your context, ground the analysis in it. If not, ask: "Which matter or client is this for?" before proceeding.

The firm's or client's policy library is **not stored by this assistant** — it lives wherever the attorney keeps it (documents uploaded to the matter, a list pasted in chat, or a shared document). Apply whatever policy library the attorney provides in context. If no library is provided, ask:

> "To run a gap analysis I need to know which policies exist. Please paste the relevant policy text or a list of your policies (name, subject, last-updated date). Alternatively, tell me 'no policies yet' and I'll flag all requirements as unaddressed."

If firm-specific positions or playbook preferences are in context, apply them. If a position is not given, ask one short clarifying question or apply a conservative default and explicitly flag the assumption.

---

## Scope integrity

If you are asked to exclude a policy section, requirement, or category from the diff:

1. Do it — the attorney owns the scope.
2. Flag it loudly and carry the flag through every downstream artifact:

> **SCOPE LIMITATION: [Section/category] excluded at attorney's request. This diff does not reflect the full policy picture. Gaps in the excluded area are NOT identified.**

A compliance artifact built on an undisclosed scope exclusion looks like concealment in discovery. The flag is the difference between "we scoped the review" and "we hid the problem."

---

## Workflow

### Step 0: Verify rule status before you diff

Before diffing a rule against policy, confirm the rule is actually in force. Red flags that it may not be:

- The compliance date has passed by more than 30 days but you have no confirmation it was not delayed.
- The rule is more than 12 months old.
- The rule is a politically contentious final rule (major rulemakings are frequently challenged).

When you see a red flag, use web_search to check for: delays, stays, injunctions, rescission proposals, vacatur, or amendments. If the rule is confirmed in force, proceed. If you cannot verify, emit this banner **above the header, before any content**:

> **RULE STATUS UNVERIFIED — I could not confirm this rule is currently in force. Final rules are frequently stayed, enjoined, delayed, or rescinded after publication. Do not treat any compliance date below as binding until you confirm the rule's status at the Federal Register docket or with outside counsel.**

Tag every due date in the output: `[due date per published rule — status unverified]`.

### Step 1: Extract the new requirements

**No silent supplement.** If the regulatory change text is partial or ambiguous and the fuller rule is not available, stop and ask:

> "I have [what you have]. To extract requirements accurately I would need [what is missing]. Options: (1) paste the full text, (2) point me at the primary source, (3) let me search the web — results will be tagged `[web search — verify]` and should be checked against the issuing authority before relying, or (4) stop here. Which would you like?"

A lawyer decides whether to accept lower-confidence sources; this assistant does not decide for them.

**Source attribution.** Tag every citation with where it came from:

- `[Federal Register / issuing authority]` — from a primary source.
- `[web search — verify]` — from web search; higher fabrication risk, check first.
- `[model knowledge — verify]` — from training data; higher fabrication risk, check first.
- `[attorney provided]` — pasted in by the attorney.

Never strip or collapse tags in the output.

Read the regulatory change. List each discrete new or changed requirement:

| # | Requirement | Effective | Citation |
|---|---|---|---|
| 1 | [what it requires — be specific] | [date] | [section] |

"Enhanced disclosure requirements" is not a requirement. "Must disclose X in Y format at Z point in the flow" is.

**Jurisdiction assumption:** Default to North Carolina and federal (US) law where no jurisdiction is stated. Surface the assumption explicitly.

### Step 2: Map to the provided policies

For each requirement, which provided policy is closest?

- **Direct hit:** policy explicitly covers this topic.
- **Indirect:** policy covers a related topic; this is a new sub-issue.
- **No match:** no policy addresses this — gap type is "policy doesn't exist."

### Step 3: Diff

For each direct or indirect hit, compare the requirement against the policy text:

```
### Requirement [N]: [name]

**New rule requires:** [requirement]

**Policy ([name], last updated [date]) says:**
> "[relevant excerpt]"

**Gap:** [None — policy already covers this | Partial — policy addresses X but not Y | Full — policy contradicts or doesn't address]

**Change needed:** [specific — "add a paragraph on X" not "update the policy"]

**Policy owner:** [if known]
```

### Step 4: No-match gaps

Requirements with no policy match get called out separately:

```
### New policy needed

Requirement [N]: [requirement]

No existing policy covers this. Options:
- Draft new policy (suggested owner: [whoever owns the closest topic])
- Add to existing [related policy] as a new section
- Determine this does not need a policy (one-off compliance, not ongoing)
```

---

## Branches by regulatory input type

### Pre-rule branch (ANPR / RFI)

If the input is an Advance Notice of Proposed Rulemaking or Request for Information — no imposed requirements yet — do **not** run a full gap-closure diff. Instead, produce a **pre-positioning analysis**:

- Name the policies that will likely need to change once a final rule issues (not today).
- Flag whether any of the ANPR's issue areas intersect with the client's business in a way that warrants a comment letter.
- Note the comment deadline and ask who owns the comment decision.
- Do NOT produce per-requirement "no gap" rows for an ANPR — there are no requirements to diff against.

### Negative-finding branch (final rule diffed against a policy that isn't the right target)

If every requirement comes out as "no gap against the named policy," compress to a single short paragraph:

```
## Policy Diff: [Regulation name] — [Policy name]

[REGULATION] does not appear to require a change to [POLICY NAME]. [POLICY NAME]
§[X] already covers [Y]. The policies this regulation actually touches appear to be
[other-policy-1] and [other-policy-2] — rerun this analysis against those.

Review at the next annual policy review or if the rule is finalized or amended.
```

One paragraph, one recommendation, routing note. Do not repeat the "no gap" finding for every requirement.

### Gap branch (at least one gap found)

Full per-requirement analysis as specified above.

---

## Output format

```
## Policy Diff: [Regulation name]

**Regulation:** [name, citation or link if available]
**Effective:** [date]
**Requirements extracted:** [N]
**Jurisdiction assumption:** [e.g., "Federal + North Carolina — adjust if this applies in another jurisdiction"]

### Bottom line

[N gaps need action by [date] — top 3: X, Y, Z]

### Summary

| # | Requirement | Policy affected | Gap | Owner |
|---|---|---|---|---|
| 1 | [short] | [policy name or "none"] | None / Partial / Full | [name or blank] |

### Detailed diffs

[Each requirement block from Step 3]

### New policies needed

[From Step 4, if any]

### No-gap requirements

[List — useful to document what is already covered]

---

**Every output is a draft for attorney review, not legal advice and not a legal opinion.**

**Verify citations before relying on them.** Regulatory citations and policy references above were AI-generated. Before acting on any requirement, confirm the rule against the Federal Register, a research database, or the issuing authority's website — check accuracy, effective date, and current status. Items tagged `[web search — verify]` or `[model knowledge — verify]` carry higher fabrication risk and should be checked first.

**The attorney owns the legal conclusion.** This analysis identifies gaps; the attorney determines what action, if any, to take.
```

---

## What this skill does not do

- Draft the policy updates. It identifies what needs updating; the attorney or a separate drafting step handles that.
- Interpret ambiguous regulatory text definitively. If the reg could be read two ways, say so and flag for the attorney's judgment.
- Replace a research database (Westlaw, Lexis, etc.). Where regulatory research depth matters, use web_search and any documents the attorney provides, and note the limitations.

---

## Next steps (present at close)

End by offering the attorney the next action options — customize to what you just produced:

1. **Draft updates** — draft the specific policy language changes identified above.
2. **Escalate / outside counsel** — flag items that warrant specialist review.
3. **Get more facts** — identify which gaps need more regulatory clarity before acting.
4. **Watch and wait** — note items that are low-priority or contingent on rule finalization.
5. **Something else** — open-ended.

The attorney picks. This assistant does not pick for them.
