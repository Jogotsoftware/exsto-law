---
slug: ai-governance.aia-generation
name: AI Impact Assessment Generation
practice_area: ai-governance
description: Run a structured AI impact assessment — intake, risk analysis, regulatory classification per applicable regime, policy consistency check, and a recommendation with conditions.
when_to_use: When the attorney says "impact assessment for", "assess this AI use case", "run an AIA", "generate an AIA", "we need to document this AI system", "AI risk assessment for X", or after a triage result points to a full assessment.
user_invocable: true
---

## Purpose

An AI impact assessment (AIA) is a documented decision, not a form. It answers: what does this AI system do, how does it reach its outputs, who is affected if it is wrong, what is the oversight structure, and is it acceptable to deploy. This skill structures that conversation and writes the output.

An AIA is not the same as a Privacy Impact Assessment (PIA). A PIA asks whether personal data is handled lawfully. An AIA asks whether the AI system is designed and deployed responsibly. They often need to happen in parallel — they are not substitutes. If the system processes personal data, flag that a PIA should be run alongside this assessment.

**Every output of this skill is a draft for attorney review. It is not legal advice and does not constitute a legal opinion. The attorney owns the legal conclusion and the sign-off.**

**Jurisdiction assumption.** Unless otherwise specified in context or by the attorney, this assessment defaults to North Carolina law and US federal law. Surface that assumption at the top of every assessment. If the client operates in the EU, a US state with its own AI statute (Colorado, Illinois, Utah, Texas, etc.), or another jurisdiction, adjust the regulatory classification accordingly and note the change.

---

## Step 0: Is an assessment needed?

Before running the full intake, check whether an AIA is actually required. Ask if any of the following apply:

- Does the AI make or materially influence a decision affecting a person (employment, credit, access, pricing, content moderation)?
- Does the AI process personal data about individuals?
- Is this a customer-facing AI system rather than purely internal?
- Does the AI use a third-party model where the client is the deployer?
- Is the use case in an elevated or high-risk category (hiring, lending, health, law enforcement, critical infrastructure)?

If none apply, say:

> "This doesn't appear to require a full impact assessment. Here is a one-paragraph record for the file explaining why — in case anyone asks later."

If the attorney has provided firm-specific trigger criteria in context, apply those. If not, apply the above defaults and flag the assumption.

---

## Step 1: Risk track

Determine which track to run before collecting intake.

**Fast track** — use when: the system is assistive (human always reviews output), affects a small internal population, processes no personal data, involves no consequential decisions, and is not customer-facing. If the attorney has given you fast-track criteria, apply them; otherwise use these defaults and flag them.

**Full assessment** — use when: the system is augmentative or automated, affects employees or customers, processes personal data, produces a score or classification that triggers an action, or touches any regulated domain (employment, credit, health, legal).

When in doubt, run the full assessment. A fast track on a system that turns out to be high-risk is worse than a thorough review of something low-risk.

---

## Step 2: Intake

Collect the following conversationally — not as a form to send to the client. Ask follow-up questions if an answer is thin.

### The system

- What does the AI do? Plain language, not marketing copy.
- Which model or vendor is powering it? Fine-tuned or off-the-shelf?
- Where does it sit in the workflow — assistive (human reviews every output), augmentative (human can override but usually doesn't), or automated (no human in the loop)?
- What is the output — generated text, a score, a classification, a recommendation, an action?

### Who is affected

- Who does the AI's output act on — employees, customers, third parties?
- If the AI produces an error (false positive, false negative, hallucination), who bears the harm and what is the worst realistic case?
- Are any vulnerable groups in scope — minors, job applicants, people in financial distress, patients?

### Inputs and data

- What data does the AI take in?
- Does it take in personal data? Whose?
- Was the model trained on data from this company, or is it a foundation model with no company-specific training?
- Where does input data go — does it leave the perimeter to a third-party model API?

### Decisions and oversight

- Does the AI output trigger an action automatically, or does a human decide what to do with the output?
- If there is human review: how often does the human actually change the AI's output? (If the answer is "rarely" — the human is not really reviewing; they are rubber-stamping.)
- Is there an appeals or correction process for people affected by the AI's outputs?
- Who is accountable for the system's outputs — is there a named owner?

### Accuracy and failure

- What is the known or estimated error rate? What testing has been done?
- What happens when the AI is wrong — is the error surfaced, logged, corrected?
- Has bias testing been done? Against what demographic groups?

### Deployment stage and scale

- **Stage:** Is this system (a) proposed and not yet built, (b) in pilot, (c) live in production, or (d) live and scaled?
- **Scale:** Roughly how many individuals are affected per month or year? How long has it been running?
- **History:** Has it been assessed before? Has it produced decisions that were challenged, appealed, or reversed?

Stage changes the assessment materially:
- Proposed → design review (can we build this safely?)
- Pilot → design review plus a "before you scale" gate
- Live → retrospective impact check (has it caused harm?) plus go-forward review
- Live and scaled → all of the above plus a remediation plan if issues are found

---

## Step 3: Regulatory classification

For each applicable regime, research the currently operative risk classification framework and determine where the system lands. If the attorney has specified the client's jurisdictional footprint in context, use it. If not, derive the applicable regimes from the client's operating jurisdictions and the use case's decision type (from Step 2 intake). Surface the derivation and flag any assumptions.

**Common failure mode:** A footprint derived from the client's general operating profile may not account for a new affected population or decision type introduced by this use case. If the use case affects employees in a state with its own AI statute, children, credit applicants, or any other population or decision type not contemplated by the general footprint, re-derive the applicable regimes rather than rely on the stale list. Flag the re-derivation to the attorney.

For each applicable regime, research and determine:

- The regime's risk tier taxonomy (e.g., prohibited / high-risk / limited / minimal, or the regime's equivalent)
- The criteria for each tier, with pinpoint citations to the controlling provision
- Which tier this system falls into, given its function, affected parties, and decision consequentiality
- Whether any prohibited practices are triggered — treat any possible match as critical and flag immediately
- Transparency obligations that apply regardless of tier (disclosure to users, notice to people subject to automated decisions, labeling of AI-generated content)
- If the client is a builder or provider of a model or AI service (not just a deployer): provider-level obligations (technical documentation, training data transparency, systemic-risk testing, copyright compliance)
- Whether the regime requires a separate Fundamental Rights Impact Assessment (FRIA) or equivalent as a distinct deliverable — if so, flag it explicitly; this AIA does not substitute for it

Do not assume internal-only systems are out of scope. Most regimes treat employee data as personal data and employee monitoring as consequential.

**If the client's AI role is "Both" (builder and deployer):** Include a provider-vs-deployer obligation mapping table per regime, as most regimes impose materially different obligations on each:

| Obligation | As provider/builder | As deployer/user |
|---|---|---|
| [specific obligation, pinpoint cite] | [what applies] | [what applies] |

**Source attribution.** Tag every citation with its source and confidence level:

- `[settled]` — stable, well-known statutory references unlikely to have changed (e.g., the existence of the EU AI Act, GDPR Art. 22 as a concept). Verify before certifying; lower priority.
- `[verify]` — model-knowledge citations that are real but should be verified: specific delegated/implementing acts, regulator guidance, state AI statute provisions, harmonized standards, effective dates, EEOC guidance, anything recent.
- `[verify-pinpoint]` — specific article/section/subsection citations carry the highest risk of error and should always be checked against a primary source. EU AI Act article numbers in particular shifted during consolidation.
- `[web search — verify]` — retrieved via web search; check against the issuing authority before relying.
- `[attorney provided]` — supplied by the attorney; treat as authoritative for this assessment.

Use web_search and any documents or sources the attorney provides. Note that web search cannot substitute for a formal legal research tool (Westlaw, etc.) for citation verification — flag this limit on any `[verify]` or `[verify-pinpoint]` citation.

**For non-lawyer clients:** Do not use inline `[verify]` tags for uncertain dates, thresholds, or deadlines — a non-lawyer reading "effective February 1, 2026 [verify]" may treat the date as confirmed. Instead, replace uncertain inline assertions with "effective date: confirm with counsel" and collect all uncertain items in a final section titled:

> **Things I am not certain about — ask your attorney to confirm before relying on this:**

List each item with: (1) what I said, (2) what I am uncertain about, (3) why it matters. Attorney clients get the inline `[verify]` treatment.

**High-risk or prohibited classification:** Flag immediately in the assessment, citing the specific provision and regime. Note that this AIA documents the internal review but does not substitute for any formal conformity assessment the regime requires. Recommend external legal review before deployment in the affected jurisdiction.

---

## Step 4: Write the assessment

Present the assessment in chat for the attorney to review and save in the app if they choose. If a matter or client is active in context, ground the assessment in it; otherwise ask which matter this is for.

Apply the firm's stated document style if provided in context. If no house style is given, use this default structure:

```
DRAFT — FOR ATTORNEY REVIEW — NOT LEGAL ADVICE
[Prepared for: client name | Matter: matter name if known | Date: today's date]

# AI Impact Assessment: [System/Feature Name]

**Prepared by:** [name] | **Date:** [date] | **Status:** DRAFT
**System owner:** [name] | **Governance reviewer:** [name]
**Governance tier:** [Standard / Elevated / High]
**Track:** [Fast track / Full assessment]

---

## Executive summary

[Two sentences: what this AI does and whether it is okay to deploy. E.g., "This system uses a third-party LLM to draft initial responses to customer support tickets before human agent review. Processing is consistent with applicable policy; three conditions are required before production deployment."]

**Overall risk:** Low / Medium / High / Very high

---

## 1. System description

**What it does:** [plain English]
**Model / vendor:** [who provides the AI]
**Deployment mode:** [Assistive / Augmentative / Automated]
**Output type:** [text / score / classification / recommendation / action]
**Status:** [Proposed / Pilot / Production / Production — scaled]

---

## 2. Affected parties

**Who it acts on:** [employees / customers / third parties]
**Scale:** [how many people, how often]
**Harm if wrong:** [most realistic worst case — specific, not generic]
**Vulnerable groups in scope:** [yes — who / no]

---

## 3. Data inputs

**Data categories used:** [specific fields, not "user data"]
**Personal data:** [yes — whose / no]
**Data leaves perimeter?** [yes — to which vendor / no]
**Model training:** [company data used / foundation model / fine-tuned on what]

---

## 4. Decision-making and oversight

**Human in the loop:** [Always / Nominally (rubber-stamp risk) / No]
**Override mechanism:** [how a human can intervene or correct]
**Appeals / correction for affected parties:** [yes — how / no]
**Named owner:** [name or role]

---

## 5. Accuracy and bias

**Error rate:** [known / estimated / untested]
**Failure mode:** [what happens when it is wrong — surfaced? logged? corrected?]
**Bias testing:** [done — results / not done / not applicable]

---

## 6. Regulatory classification

[One subsection per applicable regime]

**Regime:** [name]
**Jurisdiction assumption:** [NC / US federal / state — identify if derived]
**Classification under this regime:** [tier, with pinpoint citation]
**Prohibited practices triggered:** [none identified / specific provision and why]
**Applicable obligations:** [researched list with citations]
**Fundamental Rights Impact Assessment (FRIA) required?** [Yes — cite authority; this is a separate deliverable / No / Not applicable]
**Effective / enforcement date:** [date or "confirm with counsel" for non-lawyer clients]
**Ambiguity or open interpretation:** [flag unsettled areas]

---

## 7. AI policy consistency

[Cross-check against any AI policy commitments the attorney has provided in context. If none provided, note that and ask whether the client has an AI use policy to check against.]

| Policy commitment | Consistent? | Notes |
|---|---|---|
| [commitment] | Yes / Partial / No | |

[If any item is Partial or No: one of them has to change before deployment — either the design or the policy. Do not leave both flagged and open.]

---

## 8. Risks and mitigations

[Aim for 2–5 real, specific risks tied to this design. Avoid generic risks like "AI hallucination" or "vendor risk" — see the quality standard below.]

| # | Risk | Likelihood | Impact | Mitigation | Status | Owner |
|---|---|---|---|---|---|---|
| 1 | [specific risk] | L/M/H | L/M/H | [specific control] | Done / Planned / Gap | [name] |

**Residual risk after mitigations:** [assessment]

---

## 9. Recommendation

**[APPROVED / APPROVED WITH CONDITIONS / CHANGES REQUIRED / NOT APPROVED]**

**Conditions (if any):**
- [ ] [specific action before deployment — owner, deadline]

**Privacy review required?** [Yes — a PIA should be run separately for this system / No]
**Vendor AI review required?** [Yes — if no AI-specific addendum has been reviewed for the vendor / No]

**Sign-off:** _____________________________ [name, date]

---

## Citation verification note

Regulatory citations in Section 6 were generated by an AI assistant and have not been verified against primary sources. Before this assessment is certified or relied on, verify each cited provision against a legal research tool (Westlaw, the Official Journal of the EU, or the issuing regulator's website). The AI regulatory landscape is moving quickly. Citations tagged [verify] or [verify-pinpoint] carry higher risk of error and should be checked first.
```

---

## Risk quality standard

Risks must be specific and tied to this design. Vague risks add no value.

| Weak | Why | Better |
|---|---|---|
| "AI hallucination" | Applies to every LLM; says nothing about this system | "Model may generate plausible but incorrect legal citations — support agents have no current verification step before sending to customers" |
| "Bias" | Too vague | "Résumé scoring model trained on historical hires; if the historical cohort was demographically homogeneous, underrepresented candidates may be systematically scored lower" |
| "Vendor risk" | Circular | "OpenAI's terms permit training on API inputs by default; unless the opt-out is confirmed in the vendor agreement, customer support messages may be used to train the model" |

---

## AI policy consistency check

Cross-check the system against any AI policy the attorney provides. Common mismatches:

- Policy prohibits AI use in a particular category — this use case is that category. Stop.
- Policy requires human review — this deployment has no human step. Design must change.
- Policy requires disclosure to affected parties — disclosure mechanism has not been built.
- Policy references an approved vendor list — this vendor is not on it. Procurement step required.

Flag every mismatch. One of them must change before deployment — not both flagged and left unresolved.

---

## Handoffs

After the assessment, recommend specific next steps:

- **To product / engineering:** Conditions list with named owners and deadlines. Not "add oversight" but "add a human review step before any automated email is sent — owner: [product lead] — before launch."
- **To privacy:** If personal data is involved — "A PIA should be run separately for this system. The AIA does not substitute for a privacy impact assessment."
- **To vendor review:** If a new AI vendor is involved and no AI-specific addendum has been reviewed — "Obtain and review the vendor's AI/data processing addendum before production."
- **To regulatory counsel:** If the assessment surfaces a high-risk or prohibited classification, or a new regime the client has not previously addressed — "Recommend external legal review before deployment in the affected jurisdiction."

Close with a short decision tree: what the attorney can do next (e.g., approve the draft, send conditions to the client, order specific fixes, escalate to outside counsel, flag for a board-level AI governance review, or ask a follow-up question). The attorney picks.

---

## What this skill does not do

- It does not approve the deployment. A human attorney signs the assessment.
- It does not constitute any regulatory conformity assessment. Where a regime (e.g., EU AI Act) requires a formal conformity assessment, that is a separate exercise requiring technical documentation and, typically, external legal review.
- It does not design the mitigations. It identifies what needs mitigating; the engineer or product team designs the fix.
- It does not substitute for a PIA when personal data is involved. Run both in parallel.
- It does not substitute for a Fundamental Rights Impact Assessment where one is separately required by law.
