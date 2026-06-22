---
slug: employment.leave-tracker
name: Employee Leave Tracker (FMLA and State Leave Deadline Checker)
practice_area: employment
description: On-demand check of open employee leaves to surface only the ones with imminent or overdue designation, certification, or exhaustion deadlines — not a status board, but an action list.
when_to_use: Attorney asks which leaves need attention, says "check our open leaves," mentions an employee is on FMLA or state leave, or asks about designation/certification deadlines for any leave.
user_invocable: true
---

## Purpose

Leave-law violations often happen not because the employer took the wrong action, but because no one tracked the clock. FMLA and most state-leave regimes impose hard deadlines for designation notices, medical-certification requests, and certification receipt. Missing a deadline can eliminate defenses and trigger DOL liability. This skill surfaces only the leaves that require a decision — not a full status board.

Every output produced by this skill is a draft for attorney review, not legal advice. The attorney owns the legal conclusion. Do not file, send, or rely on any output without attorney sign-off.

**Jurisdiction assumption.** Default to North Carolina / federal FMLA when no jurisdiction is given. Surface the assumption explicitly. Ask the attorney to confirm the employee's actual work state before finalizing any deadline calculation, because state-leave rules and mini-FMLA statutes vary materially.

---

## Matter context

If a matter or client is in your context, ground the review in it. If not, ask which client or matter this is for so the output can be associated correctly. The attorney can save the result in the app once reviewed.

---

## Workflow

When the attorney asks you to check open leaves or track a specific leave, follow the steps below. This is an on-demand review — run it whenever the attorney asks, rather than waiting for a scheduled check.

### Step 1: Gather leave data

Ask the attorney to provide a list of open leaves, or to paste/describe the leave details for any specific employee. Collect the following for each leave:

- Employee name or anonymized identifier (role is fine)
- Work state (this determines which rules apply)
- Leave type: FMLA, state leave (which state), USERRA, ADA accommodation, or combination
- Leave start date
- Whether the leave is continuous or intermittent
- Expected return date, if known
- Whether the designation notice has been sent — if yes, date sent
- Whether a medical certification was requested — if yes, date requested
- Whether certification has been received — if yes, date received
- Approximate leave used to date (hours or days), if tracking exhaustion

If no HRIS or leave data has been provided, tell the attorney: "I'll need the open leave details to run this check — please share a summary, spreadsheet, or description of each open leave, and I'll flag what needs action."

Apply the firm's stated leave policies if they are provided in your context. If no firm-specific positions are given, use conservative federal defaults and flag the assumption explicitly.

---

### Step 2: Apply deadline rules by leave type

For each leave, compute the next hard deadline. The rules below are federal FMLA defaults; research state-specific rules via `web_search` for any leave in a state with a mini-FMLA or mandatory paid-leave statute (California, Colorado, Connecticut, Massachusetts, New Jersey, New York, Oregon, Washington, and others — the list changes as states enact legislation). Cite and verify every state-specific rule before relying on it.

**FMLA — federal defaults** `[model knowledge — verify currency before relying]`

| Clock | Deadline | Rule |
|---|---|---|
| Designation notice | 5 business days from when the employer has enough information to determine FMLA eligibility | 29 C.F.R. § 825.300(d) |
| Medical certification request | Must be requested within 5 business days of the leave request | 29 C.F.R. § 825.305(b) |
| Employee deadline to return certification | 15 calendar days from request (employer must allow more time if not practicable) | 29 C.F.R. § 825.305(b) |
| Exhaustion alert | Flag at 75% of the entitlement (e.g., 9 weeks of a 12-week entitlement) | Best practice — not a statutory deadline |
| Recertification | Every 30 days for a continuing condition, or when the employer has reason to doubt (minimum 30-day gap between requests) | 29 C.F.R. § 825.308 |
| Return-to-work fitness notice | Employer may require; must be communicated in designation notice if required | 29 C.F.R. § 825.312 |

**USERRA** (military leave) `[model knowledge — verify]`

- Reemployment deadlines depend on leave length (8 days / 30 days / 90 days / 180+ days from service completion date). Research the specific bracket for the leave.
- Health insurance continuation: employee may continue coverage for up to 24 months; employer cannot terminate health benefits on the first day of military leave.

**ADA accommodation** (leave as accommodation)

- No hard statutory deadline, but unreasonable delay in engaging the interactive process is itself a violation. Flag if more than 10 business days have passed without documented interactive-process activity.
- The interactive process must be documented. Ask whether any documentation exists.

---

### Step 3: Triage and alert

After computing deadlines, sort leaves into three buckets:

**🔴 Overdue — action required immediately**
- Designation notice not sent and more than 5 business days have passed from the point the employer had qualifying information
- Medical certification not received and the 15-day window has closed without employer-granted extension
- USERRA reemployment deadline passed without action

**🟠 Due within 5 business days — action required this week**
- Designation notice due within 5 business days
- Certification due within 5 business days
- Employee at or above 75% exhaustion without a status conversation documented

**🟡 Upcoming — no immediate action, flag for calendar**
- Any deadline more than 5 business days out
- Recertification windows opening soon
- Intermittent-leave pattern changes that may trigger recertification rights

**🟢 Clean**
- All required notices sent and documented
- Certification received
- No exhaustion alert triggered
- No imminent deadline

Report 🟢 leaves in a single summary line each. Do not clutter the output with clean leaves — the attorney needs to see what needs doing.

---

### Step 4: Per-leave action note

For each 🔴 or 🟠 leave, produce a one-paragraph action note covering:

1. What the deadline is and why it applies
2. What document or action is needed (designation notice, certification request, certification extension, return-to-work notice, etc.)
3. The specific risk if the deadline is missed
4. One question I'd ask before acting: [the thing a thoughtful reviewer would notice that the checklist doesn't prompt for]

Flag any item requiring a judgment call with `[review]` inline.

---

### Step 5: Offer draft notices

For any 🔴 or 🟠 leave, offer to produce a first draft of the required notice or letter for attorney review. Standard documents include:

- FMLA designation notice (using or adapting DOL Form WH-382)
- Medical certification request letter (pointing to DOL Form WH-380-E or WH-380-F)
- Certification extension letter
- Exhaustion warning letter
- FMLA denial notice
- Return-to-work notice requiring fitness certification

All drafts are marked `DRAFT — FOR ATTORNEY REVIEW` and must be reviewed by the attorney before sending.

---

### Step 6: Decision tree

After presenting the action list, close with:

> **What next? Pick one and I'll help:**
> 1. **Draft the notice** — I'll produce a first draft of [the specific notice needed] for your review.
> 2. **Dig into a specific leave** — tell me which one and I'll do a deeper deadline analysis.
> 3. **Run a jurisdiction check** — for any leave in a state with additional rules, I'll research the state-specific overlay.
> 4. **Add a new leave** — describe the employee, leave type, jurisdiction, and start date, and I'll set up tracking from today.
> 5. **Something else** — tell me what you need.

---

## Key FMLA eligibility thresholds `[model knowledge — verify]`

Before computing any FMLA deadline, confirm the employer and employee both qualify:

- **Employer coverage:** 50+ employees within 75 miles of the employee's worksite
- **Employee eligibility:** 12 months employed + 1,250 hours worked in the prior 12 months + works at a covered site
- **Entitlement:** 12 workweeks per leave year (or 26 weeks for military caregiver leave)
- **Leave year:** The employer must choose a method (calendar year, fixed 12-month period, rolling forward, or rolling backward) and apply it consistently. Research or ask which method the firm's client uses.

If eligibility is uncertain, flag it — FMLA protections do not attach if the employer is not covered or the employee is not eligible, but asserting that is a legal conclusion the attorney must own.

---

## North Carolina specifics `[model knowledge — verify currency]`

North Carolina does not have a state FMLA analog (no mini-FMLA). The primary leave protections for NC employees are:

- Federal FMLA (for eligible employers/employees)
- NC Wage and Hour Act (does not mandate leave)
- NC Retaliatory Employment Discrimination Act (REDA) — prohibits retaliation for certain protected activities
- ADA and NC Persons with Disabilities Protection Act — may require leave as accommodation
- Pregnancy Discrimination Act and related ADA protections for pregnancy/childbirth

For NC-based employees, the federal FMLA rules in Step 2 apply without a state overlay. Run `web_search` to confirm no recent legislative changes before advising.

---

## Common risk flags

Surface these in the action note for any affected leave:

- **Light-duty offer during FMLA:** employer cannot require an FMLA-eligible employee to accept light duty in lieu of FMLA leave without the employee's consent — flag if this is being considered
- **Concurrent ADA/FMLA:** when a serious health condition may also be a disability, the interactive process must continue after FMLA exhaustion — flag if exhaustion is approaching
- **Intermittent-leave abuse suspicion:** recertification requires a 30-day gap between requests; employer cannot deny based on pattern suspicion alone without proper grounds — flag and ask attorney to confirm facts before acting
- **USERRA + FMLA overlap:** military caregivers may have up to 26 weeks; confirm which leave type controls
- **State leave running concurrently:** if the employee is in a state with its own leave statute, determine whether state leave runs concurrently with FMLA or stacks on top — this is a common source of employer error

---

## Source attribution

- `[model knowledge — verify]` — all statutory rules and deadlines unless confirmed from a primary source this session
- `[web search — verify]` — if you run a search and cite a result, tag it
- `[user provided]` — leave data or documents the attorney shares
- `[statute / regulator site]` — only if you fetch primary text from an official source in this session

Every cite in this skill is tagged. Do not upgrade a tag because the cite "seems right."

---

## Guardrails

- Every output is a draft for attorney review. Not legal advice. Not a legal opinion.
- The attorney owns the legal conclusion — especially on eligibility determinations, designation decisions, and whether to deny or delay leave.
- Do not help send any notice or letter until the attorney has reviewed and approved it.
- Privilege check: FMLA leave-tracking materials are typically prepared in the course of HR administration, not at attorney direction. If the attorney is involved because of anticipated litigation, document that fact clearly and consult on whether these materials should be marked attorney-client privileged and kept outside the normal HR file.
- Destination check: do not send or share leave records or correspondence with anyone outside the attorney-client relationship without attorney instruction. Medical certification information has additional confidentiality requirements (keep separate from the personnel file).
