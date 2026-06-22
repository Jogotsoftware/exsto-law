---
slug: ai-governance.reg-gap-analysis
name: AI Regulation Gap Analysis
practice_area: ai-governance
description: Diff a new AI regulation or guidance against the client's current AI governance posture, surface compliance gaps, and produce a prioritized remediation plan with effort and risk ratings.
when_to_use: When the attorney or client asks whether a new or existing AI regulation applies to them, requests a gap analysis against a specific AI law or guidance (EU AI Act, Colorado AI Act, FTC AI policy, CFPB model-risk guidance, etc.), or pastes regulatory text and asks what needs to change.
user_invocable: true
---

## Purpose

A new AI regulation drops. An existing one phases in a new obligation. A client asks "does this affect us?" You need to know what gaps exist between what the regulation requires and what the client currently does — and what it will take to close them.

This skill structures that analysis: scope the regulation, extract every substantive requirement, diff against the client's current AI governance posture, prioritize the gaps, and produce a remediation plan the attorney can review, refine, and hand to the client.

> **Every output is a draft for attorney review, not legal advice and not a legal opinion.** The attorney owns the legal conclusion. This skill surfaces the analysis; the attorney decides what to do with it.

The AI regulatory landscape is moving faster than almost any other area of law. When a provision is genuinely ambiguous — and many are — say so. Do not paper over interpretive uncertainty. Legal teams and clients need to know when they are on solid ground versus when they are making a judgment call.

---

## Before you begin

**What you need from context:**

- The regulation, guidance, or regulatory text to analyze (the attorney should paste it, attach a document, or name it clearly).
- The client's current AI governance posture: use cases in production, existing AI policies, vendor AI terms already negotiated, any prior impact assessments, prior regulatory filings. If a matter or client is loaded in context, ground in what is there. If not, ask the attorney which matter this is for and what AI posture information they can share.
- The client's role in the AI supply chain: Are they building/providing an AI system, deploying someone else's system, or both? This distinction drives which obligations apply under most regimes.
- Jurisdiction. Default to North Carolina / United States if no jurisdiction is given, but surface the assumption.

**If a governance posture document or AI policy is not available in context:** Ask the attorney one focused question — e.g., "Can you share the client's current AI policy or a description of the AI systems in use? Even a brief summary will let me scope the gaps accurately." If they cannot provide it, proceed with a general posture of "no formal AI governance program documented" and flag every gap as a potential full gap pending confirmation.

**Apply firm or client positions if provided in context.** If a position on a particular issue is not stated, use a conservative default and explicitly flag the assumption.

---

## Step 1: Research the regulation

Before building the gap analysis, research the currently operative text of the regulation. Do not rely on model memory alone for specific thresholds, article numbers, effective dates, or phase-in schedules — these details are the ones most likely to be wrong or stale. Use web_search and any documents the attorney provides.

For each regulation, identify:

- **Scope** — who is covered: provider/builder, deployer, importer, distributor, user; sectoral carve-outs.
- **Applicability thresholds** — revenue, user count, headcount, compute, model category, affected-population size.
- **Risk-tier definitions** — how the regime distinguishes tiers (prohibited / high-risk / limited-risk / minimal, or the regime's equivalent) and what falls into each tier.
- **Substantive obligations** — transparency, documentation, human oversight, bias/accuracy testing, registration, incident reporting, vendor flow-down.
- **Enforcement mechanism** — which regulator, what penalties, any private right of action.
- **Effective dates** — many AI laws phase in obligations over 2–4 years; note which obligations are live versus upcoming.

Cite primary sources. Flag provisions subject to ongoing interpretation, delegated acts, or pending rulemaking.

**Source attribution — tag every citation:**

- `[settled]` — stable, well-known references unlikely to have changed (e.g., GDPR Art. 22; the existence of Regulation (EU) 2024/1689 as the EU AI Act; Colorado AI Act as C.R.S. § 6-1-1701 et seq.). Still verify before relying, but lower priority.
- `[verify]` — model-knowledge citations that are real but should be checked: specific delegated/implementing acts, regulator guidance, standards, thresholds, effective dates, phase-in provisions.
- `[verify-pinpoint]` — specific article numbers, annex references, subsection letters, paragraph numbers carry the highest fabrication risk and must always be verified against a primary source. EU AI Act article numbers in particular shifted during consolidation; every pinpoint cite should be checked against the Official Journal text.
- `[web search — verify]` — results from web_search; check against the issuing authority before relying.
- `[user provided]` — text or documents the attorney supplied.

**If web_search returns thin results for the regulation's text, delegated acts, or guidance:** Report what was found and ask the attorney whether to (1) broaden the query, (2) proceed with lower-confidence model knowledge tagged `[verify]`, or (3) flag as unverified and stop. Do not silently fill gaps from model knowledge without flagging.

**If the client representative asking is not an attorney:** Replace inline `[verify]` and `[verify-pinpoint]` citations with "confirm with counsel" and collect all uncertain items at the end of the analysis under: "**Items to confirm with your attorney before relying on this analysis:**" so a non-lawyer does not treat a flagged citation as settled fact.

---

## Step 2: Scope the regulation

Answer these questions before doing any gap analysis:

**Does it apply?**
- Jurisdiction match: Does the regulation's geographic or market scope reach the client?
- Role match: Does the client act as a builder/provider, a deployer, or both? Many AI regimes impose materially different obligations on each. Research the specific definitions — do not assume.
- Sector carve-outs: Does the client's sector or use case fall outside the regulation's scope?
- Thresholds: Does the client's size, user count, or system risk tier meet the regulation's coverage thresholds?

If the regulation clearly does not apply, say so directly — "This regulation does not apply. Reason: [specific reason]. No gap analysis needed for this client unless [condition that could change the analysis]." — and stop.

**When does it apply?**
- Effective date.
- Enforcement date (often different from effective date).
- Phase-in schedule for specific obligations.

**What is actually new?**
Some AI laws largely restate existing legal principles (consumer protection, anti-discrimination, sectoral risk management) applied to AI context. Others create genuinely new obligations. Flag the delta from what good existing compliance already covers.

---

## Step 3: Extract requirements

List every substantive requirement in a table:

| # | Requirement | Citation | Category |
|---|---|---|---|
| 1 | [requirement] | [section + source tag] | [category] |

**Categories:**
- **Transparency** — disclosures to users, employees, or affected parties about AI use
- **Impact assessment** — required documentation before deployment
- **Human oversight** — mandatory human review, override, or appeals mechanisms
- **Accuracy / testing** — bias testing, accuracy documentation, validation
- **Governance** — registration, record-keeping, designated responsible persons
- **Vendor flow-down** — obligations to pass down to AI vendors, or to flow up from vendors
- **Prohibited practices** — outright bans on specific AI capabilities or uses
- **Rights** — what affected parties can request or invoke

---

## Step 4: Diff against current posture

For each requirement, produce a gap entry:

```
### [Requirement #N]: [short name]

**Regulation says:** [requirement, quoted or paraphrased with citation]

**Client currently:** [what the AI policy, use case description, or prior assessment
shows — or "no documentation available" if nothing was provided]

**Gap:** None | Partial | Full | Unknown (no posture information available)

**If partial or full — what's missing:** [specific — not "more documentation" but
"no human review step is documented for [use case category]" or "vendor contract
does not include required AI transparency terms"]

**Effort to close:** Policy update only | Process change | Product/system change |
New assessment required | Vendor renegotiation | Registration/filing

**Risk of non-compliance:** [penalty range, enforcement likelihood, reputational exposure]
```

For **prohibited-practice** gaps: flag as critical regardless of enforcement date. A prohibited practice is not a process deficiency — it is a use case the client may need to terminate or restructure.

For **vendor flow-down** gaps: identify which vendor contracts are implicated. Closing these gaps typically requires contract amendments, and lead times vary.

---

## Step 5: Prioritize

Sort gaps by:

1. **Hard deadline with teeth** — enforcement date is near, penalties are real, active enforcement posture.
2. **Prohibited practice** — goes to the top of must-do regardless of enforcement timeline.
3. **Effort-to-impact ratio** — a policy language update is cheap; adding human oversight to a deployed system is a product change.
4. **Cross-cutting gaps** — a gap that affects multiple use cases is higher priority than a single-use-case gap.

---

## Step 6: Remediation plan

Present the following for the attorney to review:

```
## Remediation Plan: [Regulation name]
**Prepared for:** [Client / Matter — from context]
**Date:** [today]
**Applies to client as:** Builder | Deployer | Both
**Effective date:** [date] [source tag]
**Enforcement begins:** [date if different] [source tag]

---

### Must-do before enforcement

| Gap | Fix | Suggested owner | Due | Status |
|---|---|---|---|---|
| [gap] | [specific fix] | [role, not a named individual] | [date] | Open |

---

### Should-do (important but not blocking enforcement)

[same table]

---

### Already compliant

[List of requirements where gap = None. Useful for executive summary of where the
client actually stands, and as evidence that the analysis was done.]

---

### Accepted gaps (risk accepted — not fixing)

[If any: with documented rationale and who accepted the risk. Documenting accepted
risk is better governance than leaving it unaddressed silently.]
```

Present the remediation plan in chat for the attorney to review. The attorney should save it to the matter (using the app's document storage) or export it — do not consider the work done until the attorney has reviewed and confirmed the output.

If the gap analysis concludes the client is fully compliant, still produce the "already compliant" section. It is useful evidence that someone looked, and a useful baseline when the regulation is amended.

---

## Interpretation guardrails

- **Do not interpret ambiguous regulatory language authoritatively.** Many AI regulations — the EU AI Act especially — have significant open interpretive questions that regulators and courts have not resolved. When a provision is genuinely ambiguous: say so, state the conservative read, flag the issue as one for outside counsel if it is material, and do not pick a side the attorney has not endorsed.
- **Sector-specific AI rules require sector-specific counsel.** Healthcare AI (FDA SaMD, ONC, HIPAA AI guidance), financial services model risk management (SR 11-7, OCC guidance), employment AI (EEOC technical assistance, NYC Local Law 144), and insurance AI have overlapping but distinct frameworks. Flag when a use case likely triggers sector-specific obligations and note that specialized counsel should confirm.
- **Regulatory timelines move.** Effective dates, phase-in schedules, and enforcement priorities change. Flag any date-sensitive assertion for the attorney to verify against the issuing authority before it is communicated to the client or relied upon in a filing.
- **This skill does not track regulatory changes proactively.** It runs on-demand when the attorney asks. For ongoing monitoring, the attorney should ask to run this analysis again when new developments are identified.
- **This skill does not implement fixes.** It plans them. Technical changes, contract amendments, and product changes require follow-through outside this chat.
- **Privilege and destination.** If the attorney shares client materials or internal policy documents for the purpose of this analysis, those materials are within the privilege circle. Do not reproduce them in a form that would be shared outside it. If the attorney indicates this output will go directly to a client or third party, flag any items that should be reviewed before transmission — particularly legal conclusions, unverified citations, and items the attorney has not yet confirmed.

---

## Next steps — attorney decision tree

End every gap analysis with a short decision tree so the attorney can direct next steps:

1. **Review and confirm the gap analysis** — Are the gaps correctly identified? Any gaps missing or overstated?
2. **Prioritize the remediation plan** — Which must-dos need immediate client communication?
3. **Draft a client memo** — Summarize findings and next steps in plain language for the client.
4. **Flag for outside counsel** — Are any gaps material enough, or interpretively uncertain enough, to warrant specialized counsel?
5. **Run a use-case-specific analysis** — For a prohibited-practice flag or a high-risk tier classification, go deeper on a specific use case.
6. **Something else** — Direct the next step.

---

## What this skill does not do

- It does not provide legal advice or a legal opinion. Every output is a draft for attorney review.
- It does not authoritatively interpret ambiguous regulatory language.
- It does not proactively monitor for new regulations — it runs when the attorney asks.
- It does not implement fixes — it plans them.
- It does not substitute for sector-specific legal counsel where specialized knowledge is required.
- It does not have access to Westlaw, EUR-Lex, or any legal research database. It uses web_search and attorney-provided documents. The attorney should verify citations against primary sources before relying on them in client advice, filings, or communications.
