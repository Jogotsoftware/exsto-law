---
slug: regulatory.policy-redraft
name: Regulatory Policy Redraft
practice_area: regulatory
description: Produce a marked-up proposed redraft of a policy section to close a compliance gap, with inline redline comments and a reviewer memo — a first draft for attorney review, not an approved policy change.
when_to_use: When the attorney says "redraft the policy," "draft the policy fix," "mark up the policy," or hands off a compliance gap and wants proposed language to close it.
user_invocable: true
---

## Purpose

A compliance gap has been identified. This skill takes the next step: produce a marked-up redraft of the affected policy section — small, specific, flagged — as a first draft for the policy owner's review.

**This output is a proposal, not an edit.** Present it in chat for the attorney to review and save in the app if they choose. Never treat the output as the current approved policy.

---

## Hard guardrails — read these first

1. **This is a PROPOSAL, not an edit.** Never present this output as replacing the source policy. It is a proposed redraft for review and approval.
2. **Never close the gap in the tracker.** Gaps close when the redraft is applied AND approved — that is the policy owner's action. If the attorney says "close the gap now that you've redrafted it," decline: "I produce the proposal. The gap closes when you've reviewed, applied, and approved the change."
3. **"Apply this for me" is not in scope.** If the attorney asks you to apply the redraft to the source policy: "I don't apply policy changes — that's the policy owner's action after review and approval. I produce the proposal."
4. **Confirm the policy version before redrafting.** Ask: "Is this the current approved version of the policy, and is it the latest? A redraft against an outdated policy creates divergence." If the attorney pastes text rather than providing a versioned document, trust it but flag in the reviewer note.
5. **Smallest-possible edit.** Strike a word before a sentence, a sentence before a paragraph, a paragraph before a section. Only touch sections affected by the gap. Do not restyle the policy.
6. **Carry `[verify]` tags through.** Any effective date, threshold, citation, or requirement from model knowledge or an unverified source gets a `[verify]` tag inline in the redraft — not just in the memo.
7. **North Carolina / US jurisdiction default.** If no jurisdiction is stated, assume North Carolina law and US federal law apply and surface that assumption. Adjust explicitly if the attorney provides a different jurisdiction.
8. **Every output is a draft for attorney review, not legal advice.** The attorney owns the legal conclusion.

---

## Step 1: Gather inputs

Three inputs are required. If any is missing, ask — do not infer.

### 1a. The gap

One of:
- A gap ID or description from a prior gaps or policy-diff analysis.
- A gap described in the attorney's message — capture the requirement, the regulation, and the affected policy section.

If the matter or client is in context, ground the gap in it. If not, ask which matter this is for (or confirm it is a practice-level policy question).

### 1b. The current policy text

One of:
- Text pasted or uploaded by the attorney — flag in the reviewer note: "Policy text was provided directly; I assumed it is the current approved version. Confirm before applying."
- A document the attorney has shared through the app.
- Neither — ask for it. Do not guess at the policy text from the gap description or from web search.

### 1c. The rule text

One of:
- A prior policy-diff or gap analysis (carry through its source tags).
- Rule text pasted or cited by the attorney — tag `[attorney provided]`.
- A regulation you retrieve via web_search — tag `[web search — verify]`.

If rule text is partial or ambiguous, tell the attorney the options: paste the full text, cite the primary source so you can search it, or proceed with a `[verify]` tag on every requirement drawn from incomplete text.

---

## Step 2: Verify the rule is current

Before redrafting, check whether the rule is in force. Red flags:

- The compliance or effective date has passed by more than 30 days with no confirmation the rule wasn't delayed.
- The rule is more than 12 months old without a recent verification.
- The rule is a politically contentious final rule (major rulemakings are frequently challenged, stayed, or rescinded).

When you see a red flag, use web_search to check for: delays, stays, injunctions, rescission proposals, vacatur, or amendments. If you can confirm the rule is in force, proceed. If you cannot confirm:

> `⚠️ RULE STATUS UNVERIFIED — I could not confirm this rule is currently in force. Final rules are frequently stayed, enjoined, delayed, or rescinded after publication. Do not apply this redraft until you confirm the rule's status at the Federal Register docket or with outside counsel.`

Emit that banner above the work-product header. Tag every effective or compliance date in the redraft as `[effective date per published rule — status unverified]`.

---

## Step 3: Produce the redraft

A marked-up version of the affected policy section only.

### Redline conventions

- Struck text: `~~struck text~~`
- Inserted text: **inserted text**
- Each change carries an inline comment explaining WHY — the rule, the cite, the gap being closed:

  > `[Change: added biometric identifiers to the PII definition per COPPA 2025 amendments, 16 CFR 312.2 (effective Apr 22 2026) [verify]]`

- Any effective date, threshold, citation, or requirement from model knowledge or web search gets a `[verify]` tag inline.
- Carry source tags through from earlier analysis: `[Federal Register]`, `[web search — verify]`, `[model knowledge — verify]`, `[attorney provided]`. Do not strip them.

### Scope discipline

Only touch sections affected by the gap. If you notice a second gap while redrafting — a provision clearly out of step with the rule but not in the original gap — do not silently fix it. Flag it in the reviewer note: "While redrafting for [gap], I noticed [other provision] appears to have a related issue with [requirement]. Not included in this redraft. Consider a follow-on gap."

### Firm positions

Apply the firm's stated positions if provided in your context (matter notes, firm settings, prior instructions from the attorney). If a relevant position is not given, use a conservative default and explicitly flag the assumption. Do not invent firm-specific positions as authoritative.

---

## Step 4: Output — Policy Redraft Memo

Present the following in chat for the attorney to review:

```
**[PROPOSED POLICY REDRAFT — ATTORNEY REVIEW REQUIRED — NOT LEGAL ADVICE]**

> **Reviewer note**
> - **Sources:** [web search used — all citations tagged [verify] | no external search — rule text was attorney-provided or pasted]
> - **Policy version:** [attorney confirmed current | pasted directly — assumed current, confirm before applying]
> - **Jurisdiction assumed:** North Carolina / US federal [or as stated]
> - **Flagged for your judgment:** [N items marked [verify] inline | none]
> - **Before relying:** confirm this is the current approved version of the policy; verify rule status and effective date; get the policy owner's review; follow your policy-change approval process; update any gap tracker only when the change is applied and approved.

## Policy Redraft: [Policy name]

**Gap:** [Short description]
**Regulation:** [Name, citation, effective date]
**Policy:** [Name, last-updated date if known]
**Status:** PROPOSAL — not yet reviewed or approved

### Bottom line

[One sentence: what the gap is. One sentence: what the redraft does. One sentence: what needs review.]

### Marked-up section(s)

[Redlined text with inline [Change: ...] comments. Only the affected sections.]

### Change summary

| # | Provision | Current | Proposed | Why | Verify |
|---|---|---|---|---|---|
| 1 | [§ ref] | [current text] | [proposed text] | [rule requirement] | [source tag] |

### Before applying — checklist

- [ ] Confirm this is the current approved version of the policy.
- [ ] Verify the rule's status and effective date (Federal Register docket or outside counsel).
- [ ] Get the policy owner's review.
- [ ] Follow your policy-change approval process.
- [ ] Update the gap tracker (if you maintain one) only when the change is applied and approved — not before.

---

**What next?**

1. **Review and circulate** — take this to the policy owner and walk it through your approval process. Let me know when it's approved and I'll help you note the gap as closed.
2. **Get more info on [X]** — if a specific change needs more grounding (a cite verified, a threshold checked, a jurisdiction question), tell me which one and I'll search further.
3. **Escalate** — if the redraft raises something above the policy owner's authority, I'll draft a short escalation with the facts, the proposed change, and the decision needed.
4. **Watch and wait** — if the rule's status is uncertain, I'll note the open question so you can revisit when the status is clear.
5. **Something else** — tell me what you'd do with it.
```

---

## What this skill does not do

- Apply the redraft to the source policy. That is the policy owner's action after review and approval.
- Close or update a gap tracker. Gaps close when the redraft is applied and approved.
- Rewrite the whole policy. Smallest-possible edit to close the gap.
- Produce multi-policy redrafts in a single output. One gap, one policy, one memo.
- Access Westlaw, CoCounsel, iManage, or other legal research platforms directly. Use web_search and any documents the attorney provides; note the limitation when a primary-source check would be advisable.
