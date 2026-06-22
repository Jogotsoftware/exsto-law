---
slug: employment.wage-hour-qa
name: Wage and Hour Question and Answer
practice_area: employment
description: Answers jurisdiction-specific wage-and-hour questions — exemption classification, overtime, meal/rest breaks, final-pay timing, PTO payout, and back-pay calculations — grounded in researched, cited primary sources.
when_to_use: When the attorney asks about exemption status, overtime obligations, meal/rest break rules, final-pay timing, PTO payout requirements, contractor classification, or any back-pay/unpaid-OT computation for a specific employee or policy.
user_invocable: true
---

## Purpose

"It depends" is true but unhelpful. This skill produces a jurisdiction-specific answer grounded in researched, cited primary sources — and flags when the question is close enough to need human judgment. Do not state wage-and-hour rules from memory: salary thresholds, exemption criteria, and final-pay timing change frequently and vary meaningfully by state.

Every output is a draft for attorney review, not legal advice. The attorney owns the legal conclusion.

---

## Step 1: Identify the Jurisdiction

Which state or country is this question about? If not stated:

- If it is about a specific employee: where do they work?
- If it is a policy question: ask the attorney which jurisdiction(s) are in scope, or answer for North Carolina (the firm's home state) and explicitly flag that assumption.

Default jurisdiction assumption: **North Carolina / federal FLSA** — surface this assumption at the top of every answer and invite correction.

---

## Step 2: Research the Rule, Then State It

Research before answering. For the jurisdiction and question, identify the currently operative rule. Cite the controlling primary source (statute, regulation, wage order, or case) with a pinpoint cite. Note the effective date and whether the rule has been recently amended, indexed, or is in litigation. If you cannot verify the current state of the law, say so and flag for attorney verification — do not state a rule you have not confirmed.

**Use web_search** to verify currency, especially for:

- Salary thresholds for any exemption (federal and state — several states index annually and have tiered thresholds by employer size).
- Final-pay timing on termination vs. resignation (many states differ).
- PTO payout requirements (jurisdiction-specific; some require it, some leave it to policy, some depend on accrual-plan design).
- Meal and rest break rules and any penalty-pay consequence.
- Daily or weekly overtime rules (some states have daily overtime and double-time rules that federal law does not).
- Classification tests — the applicable test depends on jurisdiction and purpose.

**Source attribution.** Tag every citation with where it came from:
- `[web search — verify]` for citations found via web_search
- `[model knowledge — verify]` for citations recalled from training data
- `[user provided]` for citations the attorney supplied

Citations tagged `verify` carry higher fabrication risk and should be checked first. Never strip or collapse the tags.

**No silent supplement.** If web_search returns thin or no results for the jurisdiction-and-question, report what was found and stop. Say: "Search returned limited results for [jurisdiction / question]. Options: (1) broaden the search query, (2) search a different angle, (3) flag the question as unverified and stop here. Which would you like?" The attorney decides whether to accept lower-confidence sources.

---

## Common Question Types

For each of the following, the answer is jurisdiction-specific and time-sensitive. Research the rule; do not state it from memory.

- **"Is this role exempt?"** — Research the applicable federal and state salary thresholds (verify current amounts and any employer-size tiers) and the applicable duties test(s).
- **"Do we have to pay overtime for X?"** — Research federal FLSA overtime plus any state-specific overtime rules (daily OT, double-time, alternative workweeks).
- **"Do we have to provide meal/rest breaks?"** — Research the applicable state rule and any penalty-pay consequence for missed breaks.
- **"When is final pay due?"** — Research the applicable state rule, including whether timing differs for termination vs. resignation and whether waiting-time or late-pay penalties apply.
- **"Do we have to pay out accrued PTO?"** — Research the applicable state rule and any carve-out for accrual-cap or use-it-or-lose-it policies.
- **"Can we classify this person as a contractor?"** — If the facts are not already clear, ask the attorney for the key facts and apply the applicable classification test for that jurisdiction and purpose. Flag borderline cases explicitly.

---

## Step 2a: FLSA Regular-Rate and Back-Pay Calculations

When the question is a back-pay computation, unpaid-OT computation, or any question that turns on the FLSA "regular rate," use this scaffold. Do not answer from bare hourly wage × OT hours; that is the most common error this skill exists to catch.

**The regular rate is NOT just the hourly wage.** Under 29 U.S.C. §207(e), the regular rate is all remuneration for employment EXCEPT the eight statutory exclusions in §207(e)(1)–(8) (e.g., discretionary bonuses, gifts, premium pay, expense reimbursements, qualifying profit-sharing plans, qualifying stock options, retirement/insurance contributions). Anything not within those eight exclusions is in.

1. **Non-discretionary bonuses are IN the regular rate.** Productivity bonuses, attendance bonuses, commissions, shift differentials, contest awards, and most "bonuses" a reasonable employee would expect as a matter of course are non-discretionary under §207(e)(3) and 29 C.F.R. §778.211. Divide the bonus by the total hours worked in the bonus period to get the per-hour increase to the regular rate. True discretionary bonuses (§207(e)(3)) require both the fact of payment AND the amount to be within the employer's sole discretion, determined at or near the end of the period — narrow category.

2. **The unpaid OT premium is 0.5×, not 1.5× — when straight time was already paid for all hours.** If the employee was paid straight time for every hour (including the OT hours) but no premium, they are owed the half-time premium on OT hours, not time-and-a-half: `unpaid OT = 0.5 × regular rate × OT hours`. 29 C.F.R. §778.110(b). If the employee was NOT paid for the OT hours at all, the owed amount is 1.5× the regular rate on those hours. **State which pay posture you are assuming before computing** — it determines 0.5× vs. 1.5× and is the most common error in this computation.

3. **Show the math.** Print the formula and the inputs explicitly:
   ```
   Regular rate    = (straight-time wages + non-discretionary bonuses + other non-excluded comp) ÷ total hours worked
   OT premium owed = 0.5 × regular rate × OT hours    [if straight time already paid for OT hours]
                   = 1.5 × regular rate × OT hours    [if OT hours were unpaid]
   ```
   A number without the formula is not usable by a wage-and-hour attorney.

4. **Liquidated damages double the back-pay.** 29 U.S.C. §216(b). Liquidated damages equal the unpaid back-pay amount unless the employer proves, to the court's satisfaction, that the violation was in good faith and based on reasonable grounds to believe it was not a violation. 29 U.S.C. §260. Default assumption is that liquidated damages apply; the employer bears the burden to avoid them.

5. **Statute of limitations is 2 years; 3 for willful.** 29 U.S.C. §255(a). State the lookback explicitly and compute both bookends unless the willfulness posture is already established.

6. **State overlay.** Many states have longer lookback periods, higher overtime multipliers (daily OT, double-time), and different regular-rate rules. Check state wage-and-hour law against the jurisdiction identified in Step 1 and flag where state law compounds (higher cap) or replaces (different rate) federal. California, New York, Massachusetts, and Washington are the most frequent overlay states; for North Carolina matters, note that NC generally tracks federal FLSA with no state overtime rate overlay, but verify the current NC Wage and Hour Act (N.C. Gen. Stat. §§ 95-25.1 et seq.) for any recent amendments.

7. **Attach the verify tag to the number.** Any back-pay amount produced carries `[verify — consult wage-and-hour counsel before asserting or paying]` on the line the number appears.

**If any of these inputs are missing** (bonus breakdown, whether straight time was paid for OT hours, willfulness posture, state jurisdiction), **ask before computing.** A confident wrong number is the worst output this skill can produce.

---

## Step 3: Flag Close Calls Honestly

- If the answer is clear on the researched rule: say so. "Exempt — meets each element of the applicable duties test and the current salary threshold."
- If it is close: say so. "The duties test is borderline — this role could go either way. Recommend classifying as non-exempt to be safe, or getting a formal opinion."
- If the law is in flux: say so. "This rule has been amended recently — the current version takes effect [date]. Confirm effective date before relying on this answer."
- If you could not verify currency: say so. Do not guess.

Apply the firm's stated positions or playbook if provided in context. If a position is not given and the question is a judgment call, use a conservative default (e.g., classify as non-exempt when borderline) and explicitly flag the assumption. Ask the attorney one short question if a single piece of missing information would materially change the answer.

---

## Output Format

Conversational. This is a Q&A, not a memo. Present the result in chat for the attorney to review and save in the app if they choose. If a matter or client is in context, ground the answer in it; otherwise ask which matter or client this relates to.

```
**Jurisdiction:** [State the jurisdiction assumed or identified.]

**[Question restatement in one line]**

[The researched rule, one paragraph, with pinpoint cite and currency note, tagged with source attribution.]

[If close call or shifting law: the flag paragraph.]

[If the answer differs in other relevant jurisdictions: one line noting that and whether the differences are material.]

**Sources:** [List all citations with their attribution tags.]
```

> **Jurisdiction assumption.** Answers apply only to the jurisdiction identified. Wage-and-hour rules, exemption thresholds, and final-pay timing vary materially by state and country, and many rules index or change year over year. If the employee works in another jurisdiction, this answer may not apply as written.

> **Verify citations.** Any case, statute, regulation, or wage-order cite above was generated with AI assistance. Before relying on a cite, check it against the relevant state agency's site, Westlaw, or another primary source for accuracy, currency, and subsequent history. Fabricated or misquoted citations in filings or formal advice have resulted in sanctions.

---

## Next Steps

End every answer with a short decision-tree tailored to what was just produced. Customize the branches — these are defaults, not a lock-in:

- **Draft a memo or advice letter** summarizing the rule and its application to the facts — present in chat for attorney review.
- **Escalate or get a second opinion** — flag for outside wage-and-hour counsel if the question is borderline or involves significant exposure.
- **Gather more facts** — identify the specific missing input that would resolve the close call.
- **Watch and wait** — note what you would be monitoring (pending regulation, litigation outcome, upcoming threshold index date).
- **Something else** — attorney directs next step.

---

## What This Skill Does Not Do

- State the rule from memory — every answer is grounded in a researched, cited primary source verified for currency via web_search or attorney-provided materials.
- Make classification decisions for borderline cases — it states the rule and flags the close call; the attorney decides.
- Give a 50-state survey unless asked — answers for the relevant jurisdiction(s).
- Track when the answer changes — if thresholds index or law shifts, the answer goes stale; re-ask for current.
- Replace a formal wage-and-hour opinion — this skill is scaffolding for attorney analysis, not a substitute for it.
