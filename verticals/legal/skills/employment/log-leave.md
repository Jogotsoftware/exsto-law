---
slug: employment.log-leave
name: Log Employee Leave
practice_area: employment
description: Capture a new employee leave event, identify the applicable entitlement and jurisdiction rules, compute the first deadline, and present a structured leave record for the attorney to review and save.
when_to_use: When an attorney reports that an employee has gone on leave (FMLA, state leave, USERRA, ADA accommodation, or similar) and needs to start tracking designation, certification, and exhaustion deadlines from day one.
user_invocable: true
---

# Log Employee Leave

Use this skill whenever an employee goes on leave and the attorney wants to begin tracking key deadlines from day one. You will gather the minimum required information, identify the applicable legal entitlement, compute the first upcoming deadline, and surface a structured leave record for the attorney's review.

> **Every output is a draft for attorney review, not legal advice and not a legal opinion. The attorney owns the legal conclusion. Do not treat any output as ready to act on without attorney sign-off.**

---

## Step 1 — Gather information in a single prompt

Ask all of the following at once. Do not drip questions one at a time.

> A few quick questions to set up leave tracking:
>
> - Employee name or role (anonymized is fine)
> - Where do they work? (State — this determines which rules apply)
> - Leave type: FMLA / state leave (which state) / USERRA / ADA accommodation / other
> - Leave start date
> - Is this intermittent leave?
> - Expected return date (if known — leave blank if not)
> - Has the designation notice been sent? If yes, when?
> - Has medical certification been requested? If yes, when?

If a matter or client is already in context, pre-fill what you know and confirm it rather than asking redundant questions.

---

## Step 2 — Identify applicable entitlement and jurisdiction rules

Default jurisdiction is **North Carolina / federal law** if no state is given — surface that assumption explicitly.

Apply the following rules based on the leave type and state reported:

### FMLA (federal baseline — applies in all US states for covered employers)
- **Covered employers:** 50+ employees within 75 miles.
- **Entitlement:** Up to 12 workweeks per leave year; 26 weeks for military caregiver leave.
- **Designation notice:** Must be provided within **5 business days** of learning leave may be FMLA-qualifying (29 C.F.R. § 825.300(d)).
- **Medical certification:** Employee has **15 calendar days** to return a requested certification (29 C.F.R. § 825.305(b)).
- **Intermittent leave:** Employer may transfer employee to an alternative position with equivalent pay/benefits during intermittent leave.

### North Carolina state leave (if applicable)
- North Carolina does not have a separate state family/medical leave law for private employers as of the knowledge cutoff. FMLA federal rules apply.
- **NC government employees:** North Carolina State Human Resources Act provides separate leave entitlements — surface this if the employer is a state agency.
- If the attorney reports a different state, apply that state's leave law and explicitly note the jurisdiction and source of the rules you are applying.

### USERRA
- **Entitlement:** Up to 5 years cumulative military leave; reemployment rights upon return.
- **Notice:** Employee must give advance notice unless precluded by military necessity.
- **Health continuation:** Employee may elect to continue employer-sponsored health coverage for up to 24 months.

### ADA accommodation (leave as accommodation)
- No fixed duration rule — "reasonable" accommodation analysis required case-by-case.
- Employer must engage in the **interactive process**; document each step.
- Leave beyond FMLA entitlement may be required as ADA accommodation unless undue hardship applies.

> **Jurisdiction assumption:** If the employer state was not specified, these rules assume North Carolina and federal law. Confirm with the attorney if the employee works in a different state — state-specific rules may provide greater entitlements (California, New York, Washington, and others have paid family leave laws that layer on top of FMLA).

---

## Step 3 — Compute the first upcoming deadline

Based on the information collected, determine the first actionable deadline:

| Situation | First Deadline |
|---|---|
| Designation notice **not yet sent** | 5 business days from the leave start date (FMLA) |
| Med cert **requested but not yet received** | 15 calendar days from the request date |
| Designation sent **and** cert received | Flag at **75% exhaustion** of entitlement (e.g., 9 weeks into a 12-week leave) |
| USERRA — leave in progress | Flag return-to-work reemployment deadline based on leave length |
| ADA accommodation — interactive process not yet initiated | Flag immediately — initiate as soon as practicable |

For intermittent leave: note that tracking each absence increment is required; flag if a pattern exists that may indicate abuse (but do not reach conclusions — present for attorney review).

---

## Step 4 — Present the leave record

Present the structured record in chat for the attorney to review and save in the app. Do not file, send, or take any external action.

```
LEAVE RECORD — [Date Created]

Employee/Role:        [name or anonymized role]
Employer/Matter:      [matter name if in context]
Work State:           [state]
Leave Type:           [FMLA / state / USERRA / ADA / other]
Entitlement:          [e.g., 12 weeks under FMLA; 0 weeks used; 12 weeks remaining]
Leave Start Date:     [date]
Intermittent:         [Yes / No]
Expected Return:      [date or "unknown"]

Designation Notice:   [Sent [date] / NOT YET SENT]
Med Cert Requested:   [Requested [date] / NOT YET REQUESTED]
Med Cert Received:    [Received [date] / PENDING / N/A]

FIRST DEADLINE:       [what it is] — [date]
Next Watch Point:     [75% exhaustion date or next milestone]

Jurisdiction Notes:   [any state-specific rules surfaced]
Assumptions Flagged:  [list any defaults applied]

⚠ Draft for attorney review only. Not legal advice.
```

---

## Step 5 — Surface follow-up actions for attorney review

After presenting the record, list any recommended next actions as **drafts only**:

- **Designation notice** (if not yet sent): Offer to draft a designation notice letter. Note it must be sent within 5 business days.
- **Medical certification form** (if not yet requested): Offer to draft a certification request using the WH-380-E/WH-380-F or equivalent.
- **Interactive process memo** (ADA leaves): Offer to draft a memo documenting the employer's initiation of the interactive process.
- **Return-to-work checklist**: Offer to prepare a checklist of reemployment obligations.

Present these as options. Do not send or finalize anything without attorney direction.

---

## Guardrails

- **Not legal advice.** Every output is a draft for attorney review. The attorney must verify all deadlines, entitlements, and conclusions before relying on them.
- **Privilege.** Do not paste leave details or employee health information outside the privilege circle. If the attorney shares sensitive health information, treat it as confidential attorney-client matter information.
- **Jurisdiction sensitivity.** State leave laws vary significantly. If you are uncertain whether a state has a separate leave law, say so and recommend the attorney confirm before acting.
- **Conservative defaults.** When a deadline could be computed two ways, use the shorter one and flag the ambiguity.
- **No conclusions on contested facts.** If FMLA coverage is disputed (e.g., employer size is borderline), present both scenarios and let the attorney decide.
- **Attorney owns the legal conclusion.** You surface the framework; the attorney applies it.
