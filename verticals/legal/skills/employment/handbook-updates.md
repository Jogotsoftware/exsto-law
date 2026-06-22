---
slug: employment.handbook-updates
name: Employee Handbook Updates
practice_area: employment
description: Diff a proposed handbook change against current language, flag cross-reference ripple effects, identify state supplement impacts, and surface promise-reduction risks before the change is finalized.
when_to_use: Attorney says "update the handbook," "add this to the handbook," "handbook change," or provides new policy language to insert or revise in an existing employee handbook.
user_invocable: true
---

## Purpose

Handbook changes have ripple effects. Change the PTO policy and you have affected the final pay calculation, the leave policy cross-reference, and any state-specific supplements. This skill finds the ripples before they become inconsistencies.

> **Every output is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns every legal conclusion. Do not treat any output as final until it has been reviewed and approved.**

**Jurisdiction assumption:** Default to North Carolina law and federal US law unless the attorney specifies otherwise or a state supplement is at issue. Surface this assumption explicitly when it affects the analysis.

---

## Step 1 — Get the change

Ask (or confirm from context) three things:

1. Which section is changing?
2. What is the new language?
3. Why? (Legal requirement, policy decision, cleanup, or other)

If a matter or client is in context, ground the analysis in that employer's handbook. If no matter is in context, ask which employer/matter this is for before proceeding.

---

## Step 2 — Diff against current

If the attorney pastes the current language, show the diff. If they provide only the new language, note what you understand the prior language to be (based on what they have shared) and ask them to confirm before proceeding.

Present the diff in this format:

```diff
- [old language]
+ [new language]
```

---

## Step 3 — Find cross-references

Review the handbook text the attorney has shared (or ask them to paste the relevant sections) and look for:

- Other policies that cite the changed section (e.g., "see the PTO policy for accrual rates")
- Defined terms that the changed section uses or defines
- State supplements that modify the changed section

For each cross-reference found, assess: does it still make sense after the change? Flag any that break or become misleading.

If you do not have the full handbook text, note what you cannot check and ask the attorney to provide the relevant sections or confirm there are no cross-references.

---

## Step 4 — State supplement impact

For each state supplement the attorney mentions, or that is otherwise in context:

- Does the supplement currently modify the section being changed?
- Does the proposed change make the supplement obsolete, incorrect, or incomplete?
- Does the change create a need for a *new* supplement in a state that did not need one before?

If no state supplement list has been provided, ask the attorney whether the handbook has state-specific supplements and, if so, which states are covered.

**North Carolina note:** NC is an at-will employment state with no general implied-contract exception from a handbook unless the handbook expressly creates one (see *Harris v. Duke Power Co.*-line cases). Flag if the change could inadvertently create or disclaim contract language.

---

## Step 5 — Promise check

Is the proposed change reducing something the current handbook promised?

If yes, flag it. Some states — including some where the employer may have employees — treat handbook policies as implied contracts. Reducing a benefit or entitlement may require:

- Advance written notice to employees
- Fresh consideration in certain circumstances
- Careful review of any existing offer letters that incorporate handbook terms by reference

Do not block the change — but flag the risk prominently and note that the attorney should confirm how the change will be communicated and whether any individual agreements are affected.

---

## Output format

Present the result in chat for the attorney to review and save in the app if they choose.

```
## Handbook Update: [Section name]

### Proposed change

[diff]

### Cross-reference impact

| Section | References changed section | Still accurate after change? | Fix needed |
|---|---|---|---|
| [name] | [how it references] | Yes / No / Uncertain | [what to fix] |

### State supplement impact

| State | Current supplement language | After change | Action required |
|---|---|---|---|
| [state] | [what it says] | Still valid / Obsolete / Needs update | None / Update / New supplement needed |

### Promise check

[If the change reduces a prior benefit or entitlement: describe the risk, flag the jurisdictions of concern, and note what the attorney should address before publishing.]

### Ready to publish — checklist

- [ ] Cross-references updated
- [ ] State supplements updated
- [ ] If benefit reduction: notice and/or consideration addressed
- [ ] Version number and effective date updated
- [ ] Employee acknowledgment process confirmed (if required)
```

---

## What this skill does not do

- Approve handbook changes — HR and legal leadership do that.
- Draft communications to employees about the change.
- Track employee acknowledgments.
- Access Westlaw, CoCounsel, or other legal research databases. If legal research is needed to support the change (e.g., confirming a statutory requirement), use `web_search` and the sources the attorney provides, and flag the limits of that research.

---

## Firm positions

If the firm has stated positions on handbook policy defaults (e.g., at-will language approach, arbitration clauses, confidentiality tiers), apply them if they appear in context. If a relevant position is not provided, ask the attorney one short question or apply a conservative default and explicitly flag the assumption.
