---
slug: product.feature-risk-assessment
name: Feature Risk Assessment
practice_area: product
description: Produces a structured, standalone risk assessment for a single feature or product area when a launch review flags something that needs deeper scrutiny — covering scenario, likelihood, impact, mitigations, and a recommended path.
when_to_use: When the attorney says "deep dive on this risk," "risk assessment for [feature]," or "what could go wrong with [feature]," or when a launch review surfaces a novel, high-severity, or actively-regulated issue (AI, children's data, biometric, health) that needs more than a table row.
user_invocable: true
---

# Feature Risk Assessment

## Purpose

The launch review is broad. This is deep. When a single issue needs more than a table row — a novel AI feature, a children's product, something a regulator is actively scrutinizing — this skill produces a standalone decision document.

Not every launch needs one. Most don't. This is for the roughly 10% of issues where "privacy impact assessed, shipped" isn't the right level of scrutiny.

## When to run this

- A launch review found a pattern that is **not in familiar calibration territory** (novel)
- A launch review found something in a **"usually blocks"** category
- The attorney, GC, or leadership asked "what's the risk here" and wants more than a one-liner
- The feature is in an area with **active regulatory attention** (AI, children's data, biometrics, health data)
- Someone outside legal is worried and a structured written answer would help calm or escalate appropriately

If none of the above, a launch review is enough. Do not generate paperwork for its own sake.

## Jurisdiction and firm context

Default jurisdiction is **North Carolina / United States** unless the attorney specifies otherwise or the matter context indicates another jurisdiction. Surface this assumption explicitly at the top of any assessment. If a different jurisdiction applies, flag where NC/federal law may differ from that jurisdiction's requirements.

Apply any firm positions or risk appetite the attorney has stated in context. If a specific firm position on the issue at hand has not been provided, ask the attorney one short, direct question (e.g., "What is the firm's current posture on shipping AI features under active FTC attention — cautious, standard, or aggressive?") rather than inventing one. If you must proceed without an answer, use a conservative default and flag it explicitly: "Assumed conservative default — attorney should confirm."

## Matter context

If a matter or client is active in your context, ground the assessment in it. If no matter is in context and the assessment concerns a specific client matter, ask: "Which matter or client is this for?" If the attorney confirms this is practice-level (not matter-specific), proceed at the practice level.

---

## Output structure

Produce a standalone decision document — roughly 2–4 pages in chat. Present it for the attorney to review. If they want to save it to the matter record in the app, they can do so after review.

Prepend every output with:

> **ATTORNEY WORK PRODUCT — PRIVILEGED AND CONFIDENTIAL**
> This analysis is a draft prepared for attorney review. It is not legal advice and does not constitute a legal opinion. The attorney owns the legal conclusion. Verify all citations before relying on them.

If a copy is going to someone outside the privilege circle (e.g., pasted into a broadly-shared ticket or sent to a client without filtering), omit the work-product header from that externally-facing copy only — and flag to the attorney that they are moving the document outside the privilege loop before doing so.

---

## Section 1 — What we are assessing

One paragraph. What the feature does, what is new about it, and why it merited a full assessment rather than a launch-review line item.

---

## Section 2 — The risks

For each distinct risk, aim for 2–5 risks, not 15. More risks dilutes attention; save the long list for an appendix if needed.

Use this format for each:

```
### Risk [N]: [Short name]

**Scenario:** [What would have to happen for this to go wrong. Be specific —
not "data breach" but "the recommendation algorithm surfaces a user's sensitive
category interest to a third party because X."]

**Who gets hurt:** [Users? The firm's client? A counterparty? Be specific.]

**How likely:** [Low / Medium / High — with a reason. "Low — would require
both X and Y to fail simultaneously." Not a vibes rating.]

**How bad if it happens:** [Low / Medium / High — with a reason. "High —
regulatory fine plus class action exposure plus press coverage" vs.
"Low — one complaint, no actual harm."]

**Existing mitigations:** [What already reduces likelihood or impact]

**Gap:** [What is missing, if anything]

**Residual risk:** [After existing mitigations — is this acceptable or does
it need more work?]
```

---

## Section 3 — Regulatory landscape (include only if a regulator is actively interested)

- Which regulator, and what have they said or done recently in this space
- How this feature would appear to them
- Whether proactive engagement or disclosure is worth considering versus waiting

---

## Section 4 — Precedent (include if any exists)

Has another company done something similar? What happened?

- If nothing bad happened: useful data point, not dispositive
- If something bad happened: what was different about their situation, and does it apply here

Do not overweight precedent. Regulatory priorities shift; one company's enforcement history does not guarantee the next one's outcome.

---

## Section 5 — Options

Present 2–3 realistic paths:

| Option | Description | Risk reduction | Cost / tradeoff |
|--------|-------------|---------------|-----------------|
| A: Ship as designed | Current plan | None | None |
| B: Ship with [mitigation] | [Specific change] | [How much / why] | [Eng effort, timeline, UX impact] |
| C: Do not ship [component] | [Scope cut] | [How much / why] | [Product impact] |

---

## Section 6 — Recommendation

Pick one option. Explain why. Acknowledge what you are trading off.

```
**Recommended: Option [X]**

[Why. What risk remains after this option. Why that residual risk is
acceptable. Who accepts it — attorney, client, product lead?]

**If this is not the attorney's call alone:** [Who else decides, and what
they need to know to decide.]
```

---

## Research and citation standards

If the assessment cites cases, statutes, regulations, or enforcement actions — especially in the Regulatory Landscape or Precedent sections — those citations were generated by an AI model and have not been verified against a primary source.

**Before the assessment goes to any decisionmaker, verify every citation** against a legal research tool (Westlaw, CourtListener, the relevant agency's website, or another authoritative source) for accuracy, good-law status, and current enforcement posture. A risk assessment built on a fabricated enforcement action is worse than no assessment.

Tag every citation with its source:

- `[Westlaw]` or `[CourtListener]` — retrieved from a verified legal research tool
- `[regulator site]` — retrieved directly from the agency's website
- `[web search — verify]` — retrieved via web search; treat as a lead, not authority
- `[model knowledge — verify]` — recalled from training data; highest fabrication risk, verify first
- `[user provided]` — provided by the attorney or client

Never strip or collapse these tags. The decisionmaker needs to see which citations to verify first.

**On thin coverage:** If a web search or research query returns few or no results for the regulatory regime or precedent the assessment needs, say so and stop. Do not fill the gap from model knowledge without asking. Say: "Search returned [N] results. Coverage appears thin for [regime / precedent]. Options: (1) broaden the search query, (2) search the web — results tagged `[web search — verify]`, (3) flag as unverified and note the gap in the assessment. Which would you like?" The attorney decides whether to accept lower-confidence sources.

If the attorney has access to Westlaw, CourtListener, or another research platform and wants to paste in relevant materials, incorporate those sources and tag them `[user provided]`.

---

## Calibration check

Before finalizing, ask yourself:

- Is this assessment calibrated to **this client or firm**, or is it generic?
- A risk that is "High" for a company under a consent decree may be "Medium" for one that is not
- The assessment should reflect the actual regulatory posture, litigation history, and risk appetite the attorney has provided in context — not a generic industry average

If the attorney has not provided firm or client risk calibration context and it matters for the conclusion, ask one short question before finalizing the recommendation.

---

## Handoffs to consider

- **Privacy impact:** If the feature involves new data collection or processing, flag that a Privacy Impact Assessment (PIA) may also be needed. The risk sections will overlap — note that overlap so work is not duplicated, but both documents serve different purposes and audiences.
- **AI governance:** If the feature involves an AI system, flag that a dedicated AI Impact Assessment (AIA) may be needed alongside this decision document. The Feature Risk Assessment frames the product-legal decision; the AIA documents the AI system for governance purposes.
- **Vendor review:** If the feature uses a new AI or data vendor, flag that a vendor agreement review should happen if it has not already.

The attorney decides which of these parallel tracks to open.

---

## Next steps

End with a short decision tree. Customize the branches to what this specific assessment produced. Default branches as a starting point:

1. **Accept risk and ship as designed** — attorney documents the acceptance
2. **Ship with mitigation (Option B)** — attorney confirms mitigation scope with product team
3. **Scope cut (Option C)** — attorney confirms what is removed and flags to product
4. **Escalate for a second opinion** — attorney identifies who decides (GC, outside counsel, client)
5. **Get more facts before deciding** — attorney identifies what information is missing and how to get it

The attorney picks the branch. The assistant drafts whatever comes next.

---

## What this skill does not do

- It does not assess every feature. Most features get a launch review; this is for the 10% that need more.
- It does not make the decision. It frames the decision. The attorney — and any required decisionmakers — choose an option.
- It does not do quantitative risk modeling. If the client has a formal risk framework with numerical scoring, use that framework and note where this qualitative analysis feeds into it.
- It does not substitute for a verified legal research tool. Web search and model knowledge are starting points, not authority.
