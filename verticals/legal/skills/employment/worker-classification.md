---
slug: employment.worker-classification
name: Worker Classification Analysis (Employee vs. Independent Contractor)
practice_area: employment
description: Classify a proposed worker engagement — employee, independent contractor, staffing-agency temp, or vendor/SOW — by running the applicable jurisdiction tests and flagging misclassification gaps between the intended arrangement and what the facts actually support; prospective engagements only.
when_to_use: Attorney says "we want to bring on a contractor," "is this a vendor or a temp," "how should we classify this person," describes a proposed working arrangement, or asks whether an IC structure is defensible for a specific role.
user_invocable: true
---

## Purpose

The most expensive classification decision is the one nobody made consciously. Someone describes what they want ("a contractor"), the engagement starts, and two years later the facts look like employment. This skill walks the applicable tests on a proposed arrangement before it starts — and tells you when what you're describing doesn't match the structure you're trying to use.

This skill teaches the reasoning pattern. It does not state the law. Every test formulation, statutory citation, threshold, and carve-out must come from current research for the applicable jurisdiction.

**Jurisdiction assumption.** Default to North Carolina / US when no jurisdiction is given. Surface the assumption explicitly and ask the attorney to confirm where the worker will physically perform the work before finalizing any output.

---

## Matter context

If a matter or client is already in your context, ground the analysis in it. If not, ask which matter or client this is for so the output can be associated correctly. The attorney can save the result in the app once reviewed.

---

## Prospective-only hard gate — run BEFORE intake

**This skill analyzes a PROPOSED engagement before the work starts.** Before any substantive intake, ask:

> Has this work already started? Is the worker currently engaged, or have they been performing work under this arrangement for any period of time — days, weeks, months, or years?

If the answer is yes — the engagement already exists in any form, for any duration — **STOP**. Do not proceed to the intake step. Classifying an existing arrangement is not a planning exercise; it is a liability assessment with remediation implications: back pay (overtime, meal/rest premiums), unpaid employer-side payroll tax, benefits eligibility that was denied, unemployment and workers' compensation back-exposure, state penalties, and — in strict-test jurisdictions with ongoing work — the prospective exposure of letting it run another day. That analysis is privileged, led by counsel, and coupled with a remediation plan.

Output exactly this block and wait for a response:

> **Out of scope — existing arrangement.**
>
> This skill is designed to analyze a worker engagement *before it starts*, so the classification choice informs how to structure the contract and operations. You've described an arrangement that already exists. Analyzing an existing engagement retroactively is a different exercise: reclassification risk assessment coupled with remediation planning — back-pay exposure, payroll-tax back-exposure, penalty exposure, benefits exposure, and prospective restructuring. That work should be privileged, led by an attorney, and likely coupled with outside-counsel review given the dollar and enforcement exposure.
>
> Recommended next step: escalate to outside employment counsel before proceeding.
>
> **If you want to proceed with a prospective-style analysis for planning purposes only, say "proceed anyway" — but understand:**
>
> - This output is NOT a remediation plan and should not be treated as one.
> - This output does NOT scope back-pay, penalty, or payroll-tax exposure for the period already worked.
> - This output does NOT substitute for the reclassification-risk assessment that this fact pattern actually calls for.
> - Every output will carry a prominent scope-mismatch banner.

Only proceed past this gate with an explicit "proceed anyway." A hesitant "I guess" does not count — re-prompt.

If the user proceeds anyway, prepend this banner to every output for this session:

```
SCOPE MISMATCH — OUT-OF-SCOPE USE
This skill analyzes prospective worker engagements. The arrangement here
already exists. This output is the prospective-style analysis requested
for planning purposes only — it is NOT a remediation plan, does NOT scope
existing back-pay / penalty / payroll-tax exposure, and does NOT substitute
for the reclassification-risk assessment this fact pattern requires.
```

If the engagement is genuinely prospective — not yet begun — proceed to the intake step.

---

## Workflow

### Step 1 — Information gathering

Ask all of the following in a single block. Do not drip questions one at a time. Briefly explain why you're asking — attorneys answer better when they understand what the question is testing.

> To run the right classification tests I need to understand the proposed arrangement in detail. Please answer as many of these as you can — the more complete the picture, the more accurate the analysis:
>
> **The work**
> - What will this person actually do day-to-day?
> - Is this work part of the firm's or client's core business, or peripheral to it? (e.g., a software engineer at a software company = core; an IT contractor at a law firm = more peripheral)
> - Is this a defined project with a clear end, or ongoing indefinite work?
> - How specialized is the skill? Does this person have expertise the organization's team doesn't?
>
> **Control**
> - Who sets their hours and schedule — them or the company?
> - Where will they work — the company's office, their own location, or either?
> - Will the company direct how they do the work (methods, process, sequence), or just what the end result should be?
> - Will they supervise any of the company's employees?
>
> **Economics**
> - How will they be paid — hourly, daily, or fixed project fee?
> - Will the company provide equipment, tools, or software, or do they use their own?
> - Do they work for other companies, or will this be exclusive?
> - Will they bear any financial risk — can they profit beyond the fee, or lose money on the engagement?
> - Do they have their own business entity (LLC, S-corp, sole proprietor)?
>
> **The arrangement**
> - How do you want to structure this — direct contractor, staffing agency temp, or vendor/SOW (company-to-company)?
> - If staffing agency: who pays the worker — the agency or the company? Who controls day-to-day work?
> - Will there be a written contract?
> - Roughly how long is the engagement — weeks, months, over a year?
> - Will they work alongside the company's employees doing similar work?
>
> **Purpose(s) of the classification**
> - What legal purposes does the classification need to serve — federal payroll tax, FLSA wage/hour, state wage/hour, unemployment insurance, workers' compensation, benefits eligibility? Different purposes are often governed by different tests, and the answers can diverge.
>
> **Jurisdiction**
> - Where will this person physically perform the work?

Wait for responses before proceeding. If the attorney cannot answer certain questions, note the gaps — they affect the analysis.

---

### Step 2 — Identify the applicable tests

For the jurisdiction(s) and purpose(s) identified in intake, research the currently operative classification test(s) using web_search and any documents the attorney provides. Do not rely on model knowledge alone — cite primary sources and tag every citation.

Jurisdictions commonly use one or more of: an ABC test, an economic-realities test, a common-law right-to-control test, a hybrid, or a purpose-specific statutory test. The test that governs for federal payroll tax may differ from the test that governs for state wage/hour, unemployment insurance, or workers' compensation — run each purpose on its own track.

For each test, identify:
- The controlling statute, regulation, or case with pinpoint cite
- The effective date of each rule and whether it has been recently amended
- Any carve-outs or exceptions that may apply (e.g., business-to-business, professional services, construction, referral-agency)

**Source attribution.** Tag every citation:
- `[web search — verify]` — from web_search; check against a primary source before relying
- `[model knowledge — verify]` — recalled from training data; higher fabrication risk; spot-check first
- `[attorney provided]` — supplied by the attorney in this session

If a search returns few or no results for a jurisdiction-and-purpose combination, report what was found and stop. Say: "Search returned limited results for [jurisdiction / purpose / test]. Options: (1) broaden the search query, (2) try a different query, (3) flag as unverified and stop. Which would you like?" The attorney decides whether to accept lower-confidence sources. Do not fill the gap from model knowledge without asking.

If the attorney has provided the firm's classification policy in context, apply it first and flag any tension with the researched test.

---

### Step 3 — Apply the researched tests to the facts

For each test identified in Step 2, apply it to the intake facts. Score each factor or prong explicitly — do not summarize. The attorney needs to see which factors are clean and which are problems.

Use a structure like this, but populate the factors from the researched test, not from this file:

```
Test: [name of test, per research]
Purpose: [what this test governs — federal tax / state wage-hour / UI / WC / etc.]
Source: [pinpoint cite]
Currency: [verified as of date]

| Factor / prong | Intake facts | Signal / pass-fail |
|---|---|---|
| [Factor 1 from researched test] | [from intake] | [direction or pass/fail] |
| [Factor 2] | [from intake] | [direction or pass/fail] |

Structure of the test:
[How the test weighs factors — e.g., a multi-factor balancing test where no
single factor is determinative, or a conjunctive test where each prong must be
satisfied, or a hybrid. State this from research, not from memory.]

Result under this test:
[Employee-leaning / IC-leaning / Fails prong X / Uncertain — contested prong]
```

Repeat for each applicable test.

**Notes on contested prongs.** Some prongs of some tests are heavily contested in case law and fact-sensitive. Identify contested prongs explicitly — do not paper over them. Flag prongs that require attorney judgment or that have generated recent litigation in the jurisdiction.

---

### Step 4 — Classify and flag gaps

**The classification call**

Based on the test results, state the most accurate classification for the proposed arrangement:

- **Employee (W-2):** Facts support employment under one or more applicable tests for the relevant purpose(s).
- **Independent Contractor (1099):** Facts support IC status under all applicable tests for the relevant purpose(s).
- **Temp via staffing agency:** Worker will be on the agency's payroll; the company is a client — co-employment risk exists if the company exercises day-to-day control. Research the applicable joint-employer standard if relevant.
- **Vendor/SOW:** Company-to-company engagement; worker is employed by the vendor entity — cleanest structure if facts support it.
- **Unclear / close call:** Facts cut both ways under one or more tests — state which test is the problem and why.

If tests give different answers for different purposes (e.g., defensible as IC for federal tax but fails a state wage/hour test), say so explicitly and name the controlling purpose and jurisdiction.

**The gap analysis**

Compare the intended structure against what the facts actually support:

```
Intended structure: [what they said they want]
What the facts suggest: [what the researched tests say this actually is]

Gaps — where the arrangement doesn't match the intended structure:
🔴 [Factor]: [What they described] conflicts with [intended classification]
   because [specific researched test language + cite]. This is a significant
   misclassification risk if the engagement proceeds as described.
🟡 [Factor]: [What they described] is a weaker point under [test]. Not
   disqualifying alone, but combined with other factors increases risk.
✅ [Factor]: Supports [intended classification]. No issue.
```

**Escalation triggers**

Recommend outside employment counsel review before proceeding if any of the following apply:
- The jurisdiction uses a strict test (e.g., an ABC test) and the proposed work is core to the organization's business.
- Worker will supervise employees or have significant budget authority.
- Engagement expected to exceed 12 months with no clear project endpoint.
- Any contested prong where the outcome changes the classification.
- Attorney describes a prior misclassification audit or settlement — heightened scrutiny applies.

---

### Step 5 — Output

Present the result in chat for the attorney to review. Mark every output DRAFT. The attorney saves it in the app if they choose.

```
## DRAFT — Worker Classification Analysis
[DRAFT — FOR ATTORNEY REVIEW — NOT LEGAL ADVICE]

**Proposed arrangement:** [what they described]
**Jurisdiction:** [state/country — or "Assuming North Carolina; confirm work location"]
**Purpose(s):** [federal tax / state wage-hour / UI / WC / benefits]
**Tests applied:** [list, each with pinpoint cite, source tag, and currency date]

---

### Bottom line

[Can proceed as [classification] | Need to fix X first | Stop — escalate to counsel]

---

### Classification

**Closest classification:** [Employee / IC / Temp via agency / Vendor-SOW / Unclear]

[One paragraph summary of why — test results in plain language, tied to cited
and source-tagged sources.]

---

### Test results

#### [Test name — per research]
Purpose: [...] | Source: [...] | Currency: [...]
[Scored table from Step 3]
**Result:** [Employee-leaning / IC-leaning / Fails prong X / Mixed]

#### [Additional researched tests — repeat the block]

---

### Gap analysis

[Flags as structured in Step 4 — 🔴 significant risks, 🟡 weaker points,
✅ clean factors]

---

### Escalation

[None needed | Escalate to outside employment counsel before proceeding — [reason]]

---

### Next steps

[Proceed — ensure the written agreement reflects the terms that support the
classification under the researched test.]
[Or: Address the following before using IC structure: [list]]
[Or: Consider restructuring as [agency/SOW] — here's why it's cleaner for
this fact pattern.]
[Or: Do not proceed until counsel reviews the [specific issue].]
```

---

## Consequential-action gate

Before producing a "Proceed as IC / employee / agency / vendor" final recommendation, confirm the attorney has reviewed the analysis.

Classifying a worker has legal consequences — misclassification exposes the organization to back wages, taxes, benefits, penalties, and private-action risk, and in several states is strict-liability. Do not produce a final "IC viable" / "use this classification" output without the attorney's explicit confirmation that they have reviewed the analysis and are ready to proceed.

A marked-DRAFT analysis for attorney review is always appropriate before that confirmation.

The attorney owns the legal conclusion. Every output is a draft for attorney review, not legal advice.

---

## Next steps

After presenting the analysis, offer these branches:

1. **Address a gap** — draft specific contract language or operational changes to shore up the IC structure under the researched test.
2. **Restructure the arrangement** — work through whether a staffing-agency or vendor/SOW structure is cleaner for this fact pattern.
3. **Research a specific issue further** — dig deeper on a particular test, jurisdiction, or contested prong.
4. **Escalate** — flag items that need outside employment counsel review.
5. **Get more facts** — ask follow-up questions if the role description, jurisdiction, or economics are unclear.
6. **Something else** — attorney directs the next step.

---

## What this skill does not do

- Analyze an existing relationship retroactively — this is prospective only.
- Draft the contractor agreement or SOW.
- Advise on remediation if misclassification has already occurred.
- State the law for any jurisdiction from model memory — every test, factor, and carve-out must come from verified, source-tagged current research.
- Substitute for outside counsel on close calls — strict-test jurisdictions, contested prongs, and prior-audit situations require human attorney review before the engagement starts.
- Use dedicated legal research databases (Westlaw, CourtListener, etc.) — this chatbot uses web_search and attorney-provided documents; verify pinpoint cites accordingly.
