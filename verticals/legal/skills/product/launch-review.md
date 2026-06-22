---
slug: product.launch-review
name: Product Launch Legal Review
practice_area: product
description: Walk every legal category (contracts, privacy, security, IP, third-party, regulatory, marketing claims, AI governance) against a product or feature launch and produce a privileged review memo plus a redacted status block safe to share with non-legal stakeholders.
when_to_use: When the attorney says "review this launch," "can we ship this," "legal review for [feature/product]," or provides a PRD, spec, or feature description that needs a category-by-category legal sign-off before go-live.
user_invocable: true
---

## Purpose

Read the provided PRD, spec, or feature description; check every category in the framework below; calibrate severity against what actually blocks vs. what is informational; and produce a review memo the attorney can act on. Goal: the attorney (and the client's PM or product lead) knows exactly what has to happen before the product ships.

> **Every output produced by this skill is a draft for attorney review — it is not legal advice and not a legal opinion.** The attorney owns the legal conclusion and the launch call.

---

## Destination check

Before sharing any output, consider where it is going. Full review memos containing legal reasoning are privileged work product. Public channels, company-wide lists, counterparty representatives, and client contacts outside the firm's legal engagement waive that protection. This skill produces two separate outputs for exactly this reason: a full privileged memo (for the attorney and those inside the privilege circle) and a redacted non-privileged block (safe to share with the client's PM or engineering team). Never paste the full memo into a broadly shared channel or ticket.

---

## What you need before starting

Ask the attorney to provide as many of the following as possible:

- **PRD, spec, or feature description** — the primary input; paste it in chat or attach a document
- **Marketing plan or copy** — if there is a marketing component
- **Launch date** — for urgency calibration
- **Firm's known positions** — if the attorney has stated review thresholds, risk tolerances, or prior guidance on similar features, apply those; if not stated, ask one short question or use a conservative default and flag the assumption explicitly
- **Matter/client context** — if a matter is loaded in your context, ground the review in it; otherwise ask which client this launch is for

If a key input is missing, ask for it before proceeding rather than inventing assumptions.

---

## Step 1: Understand what is launching

Before the checklist, answer in plain English:

- What does this product or feature do?
- Who uses it — existing users, new users, a new segment?
- What is new versus what extends something already reviewed?
- Any new data collected, new vendors involved, new marketing claims, or new jurisdictions?

**AI detection — run before the category walk.** Check whether this launch uses AI in any form: a third-party model, an internally built model, an AI-powered vendor feature, automated scoring or classification, generative content, recommendations, or predictions. Look for this even when the PRD does not label it "AI" — words like "intelligent," "automated," "personalized," "generated," "suggested," or "recommended" are signals. If an AI component is detected, flag it prominently and apply Category 8 with full attention; do not let it disappear into a generic regulatory note.

---

## Step 2: Walk the framework

For each category below, apply the framework question to the launch. Auto-skip categories that genuinely do not apply, stating a one-line reason. Do not pad.

| # | Category | Key question | Auto-skip if |
|---|---|---|---|
| 1 | **Contractual commitments** | Does this conflict with any customer-facing promise (Terms of Service, SLA, existing agreements)? | No customer-facing changes |
| 2 | **Privacy** | New data collection, new processing purpose, new data sharing? | No data changes |
| 3 | **Security** | New attack surface, new data at rest, new access patterns? | UI-only, no backend change |
| 4 | **Intellectual property** | Third-party code or content? Open-source license obligations? Outputs that could infringe? | No new dependencies, no user-generated content |
| 5 | **Third-party** | New vendor, partner, or integration? New data processor? | No new external parties |
| 6 | **Regulatory** | Does this touch a regulated sector, audience, or jurisdiction? | Same users, same sector, same jurisdiction as existing reviewed product |
| 7 | **Marketing claims** | Any claims that need substantiation (superlatives, efficacy, comparative)? | No marketing component |
| 8 | **Artificial Intelligence governance** | Is AI used in any form? Is the use case assessed? Are vendor AI terms reviewed? | No AI component detected in Step 1 |

**Jurisdiction default.** Unless the attorney specifies otherwise, assume North Carolina law applies as the primary jurisdiction and United States federal law as the baseline. Surface this assumption explicitly. If the launch involves other states or countries, note the additional regulatory layers and flag where the analysis may differ.

**Source citations.** Use web_search and any documents the attorney provides as your research sources. This chatbot does not have access to Westlaw, CourtListener, or other subscription legal research tools. Tag every citation with its source:

- `[web search — verify]` — found via web search; verify against the issuing authority or a primary source before relying on it in a launch decision
- `[attorney provided]` — from documents or context the attorney supplied
- `[model knowledge — settled]` — stable statutory or regulatory references (e.g., FTC Act § 5, GDPR Art. 33, CCPA § 1798.100); lower fabrication risk but still verify before clearing a launch
- `[model knowledge — verify]` — specific implementing regulations, agency guidance, enforcement actions, thresholds, effective dates; verify against a primary source
- `[model knowledge — verify-pinpoint]` — pinpoint citations (specific subsections, paragraph numbers); highest fabrication risk; always verify against a primary source

If research via web search returns thin or no results for a regime, say so and stop: "Coverage appears thin for [regime]. Options: (1) broaden the search query, (2) try a different source, (3) flag as unverified and continue, or (4) stop here. Which would you like?" Do not fill gaps from model knowledge without flagging it.

**For each category, output:**

```
### [N]. [Category]

**Checked:** [what you looked at]
**Finding:** Clear | Needs work | Blocker | Skipped
**Detail:** [what the issue is, specific to this launch — not generic]
**Calibration:** [whether this is typically an FYI, requires specific work, or blocks the launch — flag if the pattern is novel and needs the attorney's call]
**Action:** [what has to happen, who owns it, by when]
```

---

### Sector overlays

If the launch touches any of the sectors below, apply the overlay alongside the base category walk. A launch that checks all eight base categories but misses a sector regime ships with a gap.

| Sector | Overlay regimes to surface |
|---|---|
| **Children / minors** | COPPA (US — services directed to children under 13 or with actual knowledge of child users) `[model knowledge — settled]`, state age-appropriate design codes (CA AADC and analogs), platform age ratings (ESRB, PEGI `[platform policy — verify against live docs]`), addictive-design scrutiny (NY Safe for Kids Act, CA SB 976 and analogs) |
| **Gaming / loot boxes / in-game currency** | Loot-box odds disclosure requirements, ESRB / PEGI descriptors `[platform policy — verify against live docs]`, state gambling law (games-of-chance vs. games-of-skill, sweepstakes promotions), FTC dark-patterns guidance, platform-store policies (Apple, Google, console) `[platform policy — verify against live docs]` |
| **Financial / fintech** | GLBA (NPI, Safeguards Rule, Reg P) `[model knowledge — verify]`, state money transmission licensing, CFPB UDAAP, state UDAP, bank-partner / "true lender" exposure, Reg E / Reg Z where applicable |
| **Health** | HIPAA (if covered entity or business associate) `[model knowledge — settled]`, FDA Software as a Medical Device / clinical decision support / general wellness exemption analysis, state health-privacy laws (WA MHMDA, NV SB 370, and analogs `[model knowledge — verify]`), FTC Health Breach Notification Rule for non-HIPAA entities |
| **Education** | FERPA (if school or school-acting service provider) `[model knowledge — settled]`, state student-privacy (NY Ed Law 2-d, IL SOPPA, CA SOPIPA + AB 1584 `[model knowledge — verify]`), COPPA if K-12 data involving users under 13 |
| **Employment / HR tech** | Title VII, EEOC guidance on AI in hiring, ADA, state AI-hiring laws (IL AIVIA, NYC Local Law 144, and analogs `[model knowledge — verify]`), state biometric laws (IL BIPA, TX/WA analogs) for video-interview or keystroke products, FCRA for background / verification products |
| **Consumer / retail / marketing** | FTC Act § 5 `[model knowledge — settled]`, Made-in-USA rule, Green Guides, CAN-SPAM, TCPA, state auto-renewal laws (ROSCA `[model knowledge — settled]`; NC GS § 75-41 and analogs `[model knowledge — verify]`), state sweepstakes/promotions law |
| **North Carolina–specific** | NC Gen. Stat. Ch. 75 (UDAP and identity theft protection act), NC Identity Theft Protection Act data breach notification requirements, NC consumer-protection statutes relevant to the product's sector `[model knowledge — verify]` |

If a sector overlay fires and the base category framework does not squarely cover it, insert it as a numbered sub-category (e.g., "6a. Sector overlay — children / COPPA") rather than burying it in a footnote.

---

## Step 3: Calibrate severity

For each finding:

- If it matches a pattern the attorney has identified as typically informational — note it, do not block
- If it requires specific work before ship — describe the work and estimate a realistic timeline
- If it blocks the launch — flag it prominently
- If the pattern is **novel** and does not fit a known prior review pattern — say so explicitly: "This does not match a prior pattern in this firm's experience — the attorney needs to make this call directly"

Apply the firm's stated risk calibration if the attorney has provided it in context. If no calibration has been stated, use a conservative default and flag the assumption.

---

## Step 4: Assemble the review

Produce both outputs below. Neither is optional. Separate them with a clear divider so the attorney cannot miss the break.

---

### Output 1 — Privileged launch review memo (internal legal work product)

```
PRIVILEGED AND CONFIDENTIAL
ATTORNEY-CLIENT COMMUNICATION / ATTORNEY WORK PRODUCT
DO NOT DISTRIBUTE OUTSIDE THE PRIVILEGE CIRCLE

# Launch Review: [Feature / Product name]

**Reviewed:** [date] | **Launch date:** [date or "not specified"]
**Client / Matter:** [from context, or "not specified — confirm"]
**Prepared by:** Exsto Law Assistant (draft for attorney review)

---

## Bottom line

[One paragraph: can this ship? What has to happen first?]

**Call:** Clear to ship | Ship with conditions | Blocked pending [X] | Needs escalation

> **Attorney gate — required before "Clear to ship" or "Ship with conditions."**
> Clearing a launch is a legal act. The output above is a draft analysis, not a legal clearance. The attorney must review all findings, confirm the call, and communicate the decision to the client. Do not present Output 2 to the client as a clearance until the attorney has reviewed and approved this memo.

---

## Findings by category

[All category blocks from Step 2 — skipped categories noted at the bottom with one-line reason]

---

## Action items

| # | Item | Owner | Due | Blocking? |
|---|---|---|---|---|
| 1 | [specific action] | [PM / eng / legal / client] | [date] | Yes / No |

---

## Open questions for attorney

[List any questions where the analysis depends on firm position, client facts, or a legal call the assistant cannot make — be specific]

---

## Escalation notes

[If any finding needs outside counsel, a specialist, or the client's GC — explain why]

---

## Notes for future reviews

[If this launch surfaces a pattern that should inform how the firm reviews similar features in the future]

---

## Citation check

All citations in this review were produced by an AI assistant and have not been verified against a primary source. Before relying on any citation in a launch decision, verify it using Westlaw, the relevant regulatory agency's website, or another primary source. Source tags on each citation show provenance and risk level; `[model knowledge — verify]` and `[model knowledge — verify-pinpoint]` tags carry the highest fabrication risk and should be checked first. Web-search citations should be verified against the issuing authority before relying on them.
```

---

### Output 2 — Redacted status block (safe to share with client's non-legal team)

```
---

## LAUNCH STATUS — SAFE TO SHARE WITH PRODUCT / ENGINEERING TEAM
(Non-privileged — no legal reasoning included)

**Launch status:** Green (Clear to ship) | Yellow (Ship with conditions) | Red (Blocked)

**Conditions before ship:**
- [ ] [Specific action written as an instruction — no legal rationale] — Owner: [name/role] — Due: [date]
- [ ] [Next condition] — Owner: [name/role] — Due: [date]

**Questions for attorney before sharing this block with the client team:**
- [List any conditions whose phrasing might leak privileged legal reasoning — the attorney should review before sending]
```

This block contains no legal reasoning, no regulatory citations, no privilege headers, and no internal legal discussion. If a condition's plain-language description would reveal the underlying legal theory, rewrite it as the action to take ("route agreement to outside counsel before execution") rather than the reason ("retaliation exposure"). The attorney reviews this block before sending it to the client's non-legal team.

---

## Handoffs

When a finding warrants deeper work, name the follow-on task explicitly rather than just noting it as an open item:

- **Privacy / data protection:** If the launch involves new personal data collection or processing, identify whether a Privacy Impact Assessment (or DPIA under GDPR) is needed and flag it as a separate work item
- **AI governance:** If an AI component was detected, assess whether a dedicated AI impact assessment is warranted and flag it
- **Vendor / contract review:** If a new vendor is involved, flag the vendor agreement for review before the launch date
- **Marketing claims:** If marketing copy needs substantiation review, treat it as a separate deliverable

Use web_search and any client-provided documents as sources for these follow-on tasks. Flag where a dedicated legal research tool would meaningfully improve confidence.

---

## Close with next steps

End the review with a concise next-steps decision tree tailored to what this review produced. Default branches:

1. Attorney approves the memo and sends Output 2 to the client's team
2. Attorney requests additional research on [specific finding]
3. Attorney escalates [specific finding] to outside counsel or specialist
4. Attorney schedules a call with the client to discuss [specific open question]
5. Something else — attorney directs

The attorney picks the branch. The assistant does not decide.

---

## What this skill does not do

- It does not replace a conversation with the client's PM. The PRD is often out of date; the review surfaces questions a human has to ask.
- It does not approve the launch. It informs the attorney's approval.
- It does not have access to Westlaw, CourtListener, Ironclad, DocuSign, or other subscription legal or contract tools. Research uses web_search and attorney-provided documents. Flag where that gap is material to a finding.
- It does not update firm policy or calibration automatically. If this launch surfaces a pattern worth capturing for future reviews, the attorney notes it and the firm's guidance is updated intentionally.
