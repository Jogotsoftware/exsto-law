---
slug: employment.hiring-review
name: Hiring Review (Offer Letter and Restrictive Covenants)
practice_area: employment
description: Review an offer letter and any restrictive covenants — classification, jurisdiction check, pay-transparency rules, background-check compliance, and covenant enforceability — and produce a marked-DRAFT memo for attorney sign-off before the offer goes out.
when_to_use: Attorney shares an offer letter, asks "can we use a non-compete here," says "hiring in [state]," asks you to check an offer, or describes a new hire and its terms.
user_invocable: true
---

## Purpose

Offer letters are mostly boilerplate until they're not. The jurisdiction check and the restrictive-covenant check are where this skill earns its keep. Every jurisdiction-specific rule is researched and cited at the time of review — rules on non-competes, salary thresholds, and pay-transparency obligations shift frequently through legislation and agency action. Do not rely on prior model knowledge for any of these calls.

**Jurisdiction assumption.** Default to North Carolina / US when no jurisdiction is given. Surface the assumption explicitly and ask the attorney to confirm the employee's actual work location before finalizing any output.

---

## Matter context

If a matter or client is already in your context, ground the review in it. If not, ask which matter or client this is for so the output can be associated correctly. The attorney can save the result in the app once reviewed.

---

## Workflow

### Step 1: Identify jurisdiction

Where will this person work? Not where HQ is — where *they* are.

- **Remote employees:** their home state/country governs.
- **Hybrid employees:** usually their home state, but check the offer letter's choice-of-law clause (it may or may not hold up).
- **New jurisdiction:** flag it explicitly — "This appears to be the firm's first hire in [state]. Research is needed before the offer goes out."

If no jurisdiction is given, apply North Carolina / federal US rules and flag: "Assuming North Carolina as the work jurisdiction. Confirm the employee's actual work location before relying on this review."

---

### Step 2: Classification (US hires)

Exempt or non-exempt? The offer should say, and the role should support it.

| Test | Check |
|---|---|
| Salary basis | Paid a fixed salary regardless of hours? |
| Salary level | Above the applicable federal and state thresholds? |
| Duties test | Does the role actually involve the exempt duties? |

Research before calling the exemption. Identify the currently operative salary thresholds (federal and state — several states index annually and several have tiered thresholds by employer size) and the applicable duties test(s) for the role. Use web_search and cite primary sources. Verify currency and tag every source (see Source attribution below).

If the offer says exempt but the role description does not support the exempt duties, flag it. Misclassification is expensive.

---

### Step 3: Restrictive covenants

If the offer includes a non-compete, customer non-solicit, employee non-solicit, confidentiality clause, or IP assignment:

Research enforceability before advising. For the employee's jurisdiction, identify the currently operative rules on each type of covenant. Non-compete enforceability in particular has shifted in multiple states through recent legislation, agency action, and litigation. Check:

- The specific covenant type — each has its own rules.
- Any salary or income threshold conditioning enforceability.
- Any notice, consideration, or garden-leave requirements.
- Any industry-specific carve-outs (healthcare, broadcasting, etc.).
- Duration and geographic-scope reasonableness tests.
- Choice-of-law and choice-of-forum enforceability for out-of-state covenants.

**North Carolina specifics (default jurisdiction):** NC non-competes are enforceable if reasonable in time, territory, and scope, and supported by adequate consideration. Courts apply a blue-pencil rule. Confirm whether consideration is adequate (signing bonus, new employment, promotion). Check for recent NC Court of Appeals or Supreme Court decisions on covenant scope.

If the firm's covenant policy is provided in context, apply it first, then overlay the jurisdiction's rules. If no policy is provided, ask the attorney: "Does the firm use non-competes selectively for this role type, or for all hires?" Flag the assumption if you proceed without an answer.

---

### Step 4: Jurisdiction-specific requirements

Research and cite current rules for:

- **Pay transparency** — does the jurisdiction require a salary range in the posting? Is this offer within any posted range?
- **Ban-the-box** — does the jurisdiction or locality restrict the timing or scope of criminal-history inquiries?
- **Salary-history limits** — does the jurisdiction restrict asking about or relying on prior salary?
- **Required offer-letter or onboarding notices** — wage-notice statutes, sick-leave notices, and similar. Research what is currently required.

For North Carolina hires: NC does not currently have a statewide pay-transparency or salary-history ban law, but confirm no local ordinance applies and check for recent legislative developments. Flag this as a researched finding, not assumed.

---

### Step 5: Offer letter content check

**At-will language (US only):** "At-will" means either party can terminate without cause or notice (subject to statutory exceptions). Check that at-will language is present for US hires and is not undermined elsewhere in the letter.

- **Montana exception:** Not at-will — Wrongful Discharge from Employment Act requires cause after the probationary period.
- **Non-US hires:** Do NOT recommend at-will language. It is legally meaningless outside the US, can conflict with mandatory statutory terms, and signals the employer did not understand the jurisdiction. For non-US, check instead for: notice period (meets statutory minimum), required written-statement particulars, probation period terms, and any jurisdiction-specific mandatory clauses.

**Check the letter for:**

- [ ] At-will language present and not undermined elsewhere (US hires only)
- [ ] Contingencies clear (background check, reference, I-9 / right-to-work verification)
- [ ] Start date, title, salary, and reporting structure stated
- [ ] Equity terms (if any) consistent with the plan
- [ ] Integration clause so the letter is the whole agreement
- [ ] Classification stated and supported by the role description
- [ ] Restrictive covenant language (if any) reviewed per Step 3
- [ ] Required jurisdiction notices included

---

### Step 6: Source attribution

Tag every citation with its source:

- `[web search — verify]` — from web_search; check against a primary source before relying
- `[model knowledge — verify]` — recalled from training data; higher fabrication risk, verify first
- `[attorney provided]` — supplied by the attorney in this session

If a search returns few or no results for a jurisdiction's rules, report what was found and stop. Say: "Search returned limited results for [jurisdiction / topic]. Options: (1) broaden the search, (2) try a different query, (3) flag as unverified and stop. Which would you like?" The attorney decides whether to accept lower-confidence sources.

---

## Output

Present the result in chat for the attorney to review. Mark every output DRAFT. The attorney saves it in the app if they choose.

```
## DRAFT — Hiring Review: [Candidate] — [Role] — [Jurisdiction]
[DRAFT — FOR ATTORNEY REVIEW — NOT LEGAL ADVICE]

**Overall:** [Changes needed | Clear for attorney sign-off | Escalate]

### Jurisdiction: [State]
[Jurisdiction identified. Any flags or first-hire-in-this-state notices.]

### Classification
[Exempt/non-exempt call, grounded in researched thresholds and duties test.
Sources tagged. Any flags.]

### Restrictive covenants
[If any. Enforceability analysis per researched jurisdiction rules, with
pinpoint cites tagged by source and a currency note. Suggested changes.]

### Jurisdiction-specific requirements
[Pay transparency, notices, salary-history rules — each researched and cited,
or flagged as needing research.]

### Offer letter
[Issues with the letter itself. Specific language concerns.]

### Action items before sending
- [ ] [specific change or confirmation needed]
```

---

## Consequential-action gate

**Before producing a "Clear for attorney sign-off" call:** confirm the attorney has reviewed the analysis. The offer letter is a contract. Restrictive covenants, classification, and jurisdiction-specific terms are difficult to reset once the letter is sent. If anything is unresolved, say so explicitly and list what the attorney needs to decide before the offer goes out.

Never produce a clean "send this" output — always mark DRAFT and require the attorney's explicit go-ahead.

---

## Next steps

After presenting the review, offer these branches:

1. **Revise the offer letter** — draft suggested edits for any flagged items.
2. **Research a specific issue further** — dig deeper on a particular covenant, threshold, or jurisdiction requirement.
3. **Escalate** — flag items that need outside employment counsel or specialist review.
4. **Get more facts** — ask follow-up questions if the role description, jurisdiction, or covenant terms are unclear.
5. **Something else** — attorney directs the next step.

---

## What this skill does not do

- Draft the offer letter from scratch — reviews and flags issues in a provided draft.
- Make the hire decision — checks the paperwork.
- State restrictive-covenant or exemption rules from memory — every jurisdiction-specific call is based on researched, cited, source-tagged findings.
- Replace attorney judgment — every output is a draft for attorney review. The attorney owns the legal conclusion.
