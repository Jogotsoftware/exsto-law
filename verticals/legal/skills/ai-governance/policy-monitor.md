---
slug: ai-governance.policy-monitor
name: Artificial Intelligence Policy Monitor
practice_area: ai-governance
description: Detect drift between the firm's AI/acceptable-use policy and its actual AI practices by diffing approved AI Impact Assessments, triage results, and vendor AI reviews against current policy commitments, then drafting specific update language.
when_to_use: When the attorney asks whether the firm's AI policy covers a proposed new AI practice, says "does our policy cover this," wants a policy sweep or gap check, or is about to approve a new AI use case or vendor AI tool.
user_invocable: true
---

# AI Policy Monitor

> **Every output from this skill is a draft for attorney review — not legal advice and not a legal opinion.** AI policy drafting involves legal judgment about regulatory exposure, employment risk, and client disclosure obligations. The attorney owns every word before it is adopted. Do not adopt suggested language without review.

AI policies drift from practice faster than almost any other policy document — the field moves quickly, use cases multiply, and each approved AI Impact Assessment (AIA), triage result, or vendor AI review represents a new commitment the policy may not have caught up with. An AIA approves a new AI use case with a human-oversight condition. A vendor AI agreement permits data processing the policy doesn't mention. A triage result marks a new category of deployment as conditional with a disclosure requirement. The policy sits unchanged.

This skill catches the drift — either by reviewing AI governance outputs the attorney provides, or by answering the direct question: "we're about to start doing X, what does that mean for our AI policy?"

**Jurisdiction assumption:** When no jurisdiction is specified, apply US federal law and North Carolina law as defaults. Surface this assumption explicitly and ask the attorney to correct it if the matter involves another state or country.

---

## How to invoke this skill

This is a chat-based, on-demand skill — there is no scheduled sweep. Invoke it two ways:

**Sweep mode** — "Review our AI governance outputs and check for policy gaps." Provide (by pasting or attaching) the AI governance documents you want reviewed: AIAs, triage results, vendor AI review summaries, or use case registry updates. The assistant will diff them against your stated policy commitments and flag gaps.

**Direct query mode** — "We want to start using [X] — does our AI policy cover it?" Describe the proposed practice; the assistant will check it against your current policy.

In both modes, if a matter or client is in context, the assistant will ground findings in it. If no matter is active, it will work from what you provide.

---

## What the assistant needs from you

Before running either mode, provide (by pasting or describing in chat):

1. **Your current AI or acceptable-use policy** — or the key commitments from it (what AI is approved for, any automation limits, disclosure commitments to clients/employees, vendor AI positions).
2. **Your use case registry** (if maintained) — approved, conditional, and never-approved AI use cases.
3. **The outputs to review** (sweep mode) — AIAs, triage results, or vendor AI review summaries since the last policy check.
4. **The proposed practice** (direct query mode) — plain description of what you want to start doing.

If the firm's AI policy positions are not provided, apply conservative defaults and flag the assumption explicitly. Do not invent firm-specific positions as authoritative.

---

## Firm's AI policy positions

Apply the firm's stated positions if provided in your context. If a position is not given, ask the attorney one short question or use a conservative default and explicitly flag the assumption.

**Conservative defaults (if not provided):**
- Assume the firm has not authorized fully automated AI decisions affecting clients or third parties.
- Assume client data should not be processed by vendor AI systems without client consent.
- Assume the firm's policy does not currently cover any AI use case unless the attorney confirms otherwise.

---

## Mode 1: Sweep

### Determine scope

Work from the AI governance outputs the attorney provides. If no outputs are provided:

> "To run a sweep, paste or attach the AI governance outputs you want reviewed — AIAs, triage results, vendor AI review summaries, or use case registry updates. I'll diff them against your current policy commitments and flag gaps."

If outputs are provided but no last-sweep date is known: "Running a full sweep of all provided outputs — no prior sweep date on record."

### What to read in each output type

**AIAs (AI Impact Assessments):**
- Extract: use case approved, AI system description, deployment mode (assistive / augmentative / automated), conditions imposed, affected parties, vendor used, any disclosure requirements to affected individuals.
- Flag: use cases not in the registry; use cases approved with conditions not reflected in policy; vendor added that policy doesn't cover; automated decision deployed where policy implies human oversight.

**Triage results (CONDITIONAL / APPROVED outcomes):**
- Extract: use case classified, tier assigned, conditions imposed.
- Flag: new use case categories not in registry; conditions that imply policy commitments (e.g., "must disclose to affected parties" — does the policy say the firm does this?); newly approved practices that expand policy scope.

**Vendor AI reviews (signed / approved):**
- Extract: vendor added, data use terms agreed to, any AI-specific provisions accepted that differ from stated standard positions.
- Flag: vendors whose data use terms the policy should reference (e.g., "we use third-party AI services and ensure they do not train on our data"); approved deviations from standard positions that the policy implies the firm holds.

**Use case registry updates:**
- If new entries were added to the registry, check whether the policy reflects those approved categories.

### Gap identification

For each flagged item, classify:

**REQUIRED update** — the policy makes a commitment that an output contradicts, or an approved use case has no policy coverage and affects external parties. Not updating creates a material misrepresentation.

> Example: AI policy says "we do not use AI in employment decisions." An AIA approved an AI-assisted hiring screening tool with human review required. Policy needs updating — even with human review, AI is now involved in employment decisions. "We do not use AI" is no longer accurate.

**ADVISABLE update** — policy is silent but not in conflict. The practice is defensible without updating, but cleaner with it. Important when the practice affects external parties or creates a reasonable expectation.

> Example: Policy says "we use AI to improve our services." An AIA approved an AI feature for drafting client communications. Policy technically covers it but is vague. Advisable to be more specific so clients know what is involved.

### Sweep output format

```
# AI Policy Monitor — Sweep Report

**Date:** [date]
**Outputs reviewed:** [list provided]
**Gaps found:** [N] REQUIRED | [N] ADVISABLE

---

## REQUIRED updates

### [Gap short name]

**Source:** [output that triggered this]
**What's happening:** [plain description of the new practice]
**Current policy:** [quote the relevant section — or "No coverage"]
**Gap:** [what's missing or inconsistent]

**Suggested language:**
> *Add to / update [section name]:*
> "[Drafted policy text — specific, consistent with the style of the policy provided]"

---

[repeat for each REQUIRED gap]

---

## ADVISABLE updates

### [Gap name]

**Source:** [output]
**What's happening:** [description]
**Current policy:** [quote or "Silent"]
**Suggested language:**
> *Add to / update [section]:*
> "[Drafted text]"

---

## No action needed

[List outputs reviewed where no gaps were found]

---

## Use case registry sync

[Any use cases approved in provided outputs not yet in the registry — suggested registry entries to add, for attorney review]

---

## Next steps

- [ ] Review REQUIRED updates — decisions needed before the associated use cases go live (or immediately if already live)
- [ ] Review ADVISABLE updates — lower urgency, address at next policy refresh
- [ ] Add new use cases to registry (if any flagged above)
- [ ] Save this report to the matter or firm file if desired
```

**Present the completed report in chat for the attorney to review.** Do not finalize any language or mark gaps as resolved — the attorney reviews and approves every change.

---

## Mode 2: Direct query

### Parse the proposed practice

Extract from the attorney's description:
- What AI system or capability is being introduced?
- What does it do — assistive, automated decisions, content generation?
- Who does it affect — employees, clients, third parties?
- Which vendor or model is involved?
- Is there human review, or is it fully automated?
- Are affected parties told the AI is involved?
- Any data flowing to a vendor that wouldn't be expected?

If the description is vague, ask one clarifying question. Direct query mode should be fast — do not run a long intake.

### Policy diff

Check the proposed practice against the current policy and use case registry:

| Check | Current policy / registry | Proposed practice | Verdict |
|---|---|---|---|
| Use case category | [registry — approved / conditional / never / not present] | [new use case] | Covered / Gap / Conflict |
| Scope of AI use | [what policy says AI is used for] | [new use] | |
| Automated decisions | [policy position on automation] | [is this automated?] | |
| Disclosure to affected parties | [what policy commits to] | [what this requires] | |
| Vendor data use | [policy position on vendor AI] | [this vendor's terms] | |
| Human oversight | [policy statement if any] | [what's actually in place] | |

### Direct query output format

```
# AI Policy Check: [Proposed practice in one line]

**Bottom line:** [POLICY UPDATE REQUIRED / ADVISABLE / NO UPDATE NEEDED]

---

## What's covered

[Aspects of the proposed practice already addressed — brief, confirms no change needed]

## What's missing

### [Gap 1]

**Current policy:** [quote or "Silent"]
**What's needed:** [why this gap matters — legal, reputational, or expectation reason]

**Suggested language:**
> *Add to [section]:*
> "[Drafted text]"

## What conflicts

### [Conflict 1 — if any]

**Current policy says:** [quote]
**Proposed practice does:** [what conflicts]
**Resolution:** [which one needs to change — usually practice adjusts to match policy, or policy is updated to a defensible new position; never silently accept both]

---

## Use case registry

[If this use case isn't in the registry, suggest a registry entry for attorney review]

---

## Timing

[REQUIRED: "Policy update should happen before this practice goes live — or immediately if it's already running."
ADVISABLE: "Can proceed; update at next policy refresh."]
```

---

## Suggested language quality standards

AI policy language is unusually prone to becoming outdated — the field moves fast and vague language ages better than specific commitments. When drafting:

- Match the voice and style of the existing policy provided by the attorney.
- Prefer durable language: "AI-assisted" rather than naming specific models that will change; "automated or AI-assisted decisions" rather than technical descriptions.
- Do not draft commitments the firm can't keep — "we always have a human review AI outputs" is broken the moment one automated workflow ships.
- When a policy position is genuinely changing (not just extending), say so explicitly: "This update reflects that we now use AI in [new category] — the previous language did not cover this."
- For disclosure language: draft it to be readable by the affected party (employee, client), not just legally accurate.
- Always say which section to add to. If the right section doesn't exist, suggest creating it and draft the header.

If you cannot find the actual AI policy text — only a summary — note this limitation and flag that suggested language should be checked against the actual document before adoption.

---

## External tools and research

This skill does not have access to Westlaw, CoCounsel, or regulatory databases. For legal research supporting policy language:
- Use `web_search` to look up current federal and state AI governance requirements (North Carolina law, FTC guidance, EEOC AI guidance, state consumer protection rules) and any pending legislation relevant to the proposed practice.
- Surface search results for attorney review — do not treat web search results as definitive legal authority.
- If the attorney provides regulatory documents or agency guidance, incorporate those.

---

## What this skill does not do

- It does not update the policy itself — it drafts suggested language and flags decisions, but the attorney reviews and approves every change.
- It does not catch incoming regulations — this skill monitors internal practice drift against the existing policy, not external legal changes. For regulatory gap analysis, ask separately.
- It does not read email, Slack, or informal decisions — only structured outputs the attorney provides in chat.
- It does not update the use case registry automatically — it flags registry gaps and drafts entries for attorney review before any changes are made.
- It does not schedule recurring sweeps — invoke it on demand when you want a policy check.

---

## Next-steps decision tree

After presenting results, end with:

> **What would you like to do next?**
> A. Draft revised policy section(s) based on REQUIRED updates
> B. Draft a memo summarizing the gaps for a partner or compliance review
> C. Get more information on a specific gap before deciding
> D. Note the ADVISABLE gaps and address at next policy refresh — no action now
> E. Something else — tell me what you need

The attorney picks the branch. Present results in chat for review and saving in the app if desired.
