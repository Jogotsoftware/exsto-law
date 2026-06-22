---
slug: privacy.reg-gap-analysis
name: Regulatory Gap Analysis for Privacy
practice_area: privacy
description: Diff a new or changed privacy regulation against the firm's current policy and practices, then produce a prioritized gap list and remediation plan with owners and target dates.
when_to_use: When the attorney asks whether a new or changed regulation affects the firm or a client, pastes regulatory text or a summary, or asks "does [regulation] apply to us" or "gap analysis for [law/guidance]."
user_invocable: true
---

## Purpose

When a new state privacy law passes, an agency finalizes rules, or a regulator issues guidance, this skill diffs the new requirement against what is currently documented — the firm's or client's stated privacy commitments and practices — and produces a gap list with a prioritized remediation plan.

**Every output is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns the legal conclusion.**

---

## Before starting

**What you need from context or the attorney:**

- The regulation or guidance to analyze (name, text, or summary). If none is provided, ask: "Which regulation should I analyze?"
- The current privacy posture to diff against. Use whichever is available: the client's existing privacy policy, any privacy impact assessments (PIAs) in the matter, or a brief description the attorney provides. If none is available, ask one short question: "Can you share the current privacy policy or a summary of what this client currently does with personal data?"
- Any firm- or client-specific positions (e.g., "we treat sensitive data as opt-in by default"). Apply stated positions if provided; if a position is not given, use a conservative default and flag the assumption explicitly.

If the matter or client is in context, ground the analysis in it. If not, ask which matter this is for before proceeding.

**Jurisdiction default:** North Carolina / United States, unless the regulation or context specifies otherwise. Surface this assumption at the top of the output.

---

## Workflow

### Step 1: Scope the regulation

Before diffing anything, answer:

- **Does it apply?** Check jurisdiction (do the client's data subjects live there?), thresholds (revenue, user count, data volume), and sector carve-outs (HIPAA-covered entities are often excluded from state privacy laws, for example).
- **When?** Effective date, enforcement date (often later), any phase-in periods.
- **What is actually new?** Many state privacy laws are largely parallel to the California Consumer Privacy Act (CCPA) or the General Data Protection Regulation (GDPR). Identify the delta from what is already addressed — do not re-analyze requirements the client already handles.

If the regulation does not apply, the output is one paragraph: "This regulation does not apply. Here is why: [reason]. No action needed." Still flag the assumption so the attorney can verify.

### Step 2: Extract requirements

List every substantive requirement as a discrete item:

| # | Requirement | Citation | Category |
|---|---|---|---|
| 1 | [requirement as stated or paraphrased] | [section] | [Notice / Rights / Security / Vendor / Consent / Governance] |

**Categories:**
- **Notice** — what must be disclosed to data subjects (privacy policy content)
- **Rights** — what data subjects can request (access, deletion, correction, portability, opt-out)
- **Security** — technical and organizational safeguards
- **Vendor** — requirements to flow down to processors or service providers
- **Consent** — opt-in or opt-out mechanics
- **Governance** — data protection officers, impact assessments, record-keeping

**Source tagging.** Tag every citation with its source:
- `[settled]` — stable, well-known statutory references unlikely to have changed (e.g., GDPR Art. 33, CCPA § 1798.100). Lower priority to verify, but still verify before relying.
- `[verify]` — model-knowledge citations that are real but should be confirmed: implementing regulations, agency guidance, thresholds, effective dates, newly enacted state statutes.
- `[verify-pinpoint]` — specific subsection letters, paragraph numbers, and pinpoint references carry the highest fabrication risk. Always verify against a primary source before relying on them.
- `[web search — verify]` — from a web_search call; check against the issuing authority.
- `[attorney provided]` — from material the attorney supplied.

### Step 3: Diff against current state

For each requirement, produce an entry in this format:

```
### [Requirement #N]: [short name]

**Regulation says:** [quoted or paraphrased requirement]

**Current state:** [what the privacy policy, PIAs, or attorney description shows — or "not documented; assumed absent"]

**Gap:** None | Partial | Full

**If partial or full — what is missing:** [specific]

**Effort to close:** Policy update only | Product or process change | Vendor renegotiation | New governance process

**Risk of non-compliance:** [penalty range if known, enforcement likelihood, reputational exposure — tagged with source tier]
```

When the regulation is ambiguous, say so explicitly: "Section X could be read as [A] or [B]. [A] is the conservative read. Recommend attorney judgment — or outside counsel if this is material."

**Do not fill gaps with invention.** If a web_search call returns thin results for a specific regulation, report what was found and offer options: (1) broaden the search, (2) try a different query, (3) proceed with results tagged `[web search — verify]` for the attorney to check, or (4) flag as unverified and stop. The attorney decides whether to accept lower-confidence sources.

### Step 4: Prioritize

Sort gaps by:

1. **Hard deadline with active enforcement and real penalties** — these come first
2. **Effort-to-impact ratio** — policy language updates are cheap; product rebuilds are not
3. **Proximity to existing controls** — if the client is 80% compliant with a similar regime, the incremental gap may be small

### Step 5: Remediation plan

Present the following in chat for the attorney to review (and save in the matter if they choose):

```
## Remediation Plan: [Regulation name]

**Jurisdiction assumption:** [state if defaulted to NC/US or derived from context]
**Effective date:** [date — [verify]]
**Enforcement begins:** [date — [verify]]

### Must-do before enforcement

| Gap | Fix | Suggested owner | Target date | Status |
|---|---|---|---|---|
| [gap] | [specific fix] | [role, not invented name] | [date] | [ ] |

### Should-do (lower risk, not blocking enforcement)

[same table]

### Already compliant

[list of requirements where gap = None — useful for the "we are mostly fine" memo]

### Accepted gaps (risk accepted, not fixing)

[if any — with documented rationale; the attorney must confirm this category]
```

---

## Common regulation categories

When scoping, place the regulation into a category and research the specifics accordingly:

- **Baseline data-protection / privacy law** — broad personal data rules for a jurisdiction (e.g., state comprehensive privacy acts)
- **Sector-specific overlay** — health (HIPAA/HITECH), finance (GLBA), children (COPPA), education (FERPA), employment
- **AI-specific regime** — transparency, impact assessments, or governance for automated decision-making
- **Data broker / ad-tech regime** — registration, opt-out, and deletion mechanics
- **Breach-notification regime** — standalone or embedded in a broader law; North Carolina has its own (N.C. Gen. Stat. § 75-65) `[verify]`
- **Cross-border transfer regime** — adequacy, transfer mechanisms, and impact assessments

For each category, research the currently operative requirements before drafting. Flag uncertainty explicitly — new state laws come online each legislative session and regulators issue interpretive guidance that shifts what compliance means. Do not assert a rule you have not confirmed from a cited source.

---

## Integration with other skills

**From Privacy Impact Assessment (PIA) work:** PIAs that flag privacy policy inconsistencies feed directly into this skill as known gaps.

**Proactive monitoring:** This skill runs on demand when the attorney asks. It does not automatically watch regulatory feeds. If the attorney wants to track a regulatory area over time, they can ask periodically ("check whether anything has changed in [area] since [date]") and this workflow will run fresh.

---

## Closing elements

**Always include a citation-verification note at the end of every output:**

> Citations in this output were generated by an AI model and have not been independently verified. Before relying on any regulation, statute, guidance, or enforcement action, check it against a primary source (the issuing authority's website, Westlaw, or your firm's research platform) for accuracy and current status. AI-generated citations carry fabrication risk; `[verify]` and `[verify-pinpoint]` tags in the output mark the highest-risk items — check those first.

**Close with a next-steps decision tree:**

Present 3–5 concrete options based on what the analysis produced. Examples (customize to the output):

1. Draft the remediation plan as a client memo
2. Draft updated privacy policy language to close specific gaps
3. Identify vendors requiring updated data processing agreements
4. Escalate a material gap to outside counsel for a formal opinion
5. Flag and stop — the attorney wants to review the gap list before any drafting proceeds

The attorney picks. Do not proceed past the decision tree without a direction.

---

## What this skill does not do

- It does not interpret ambiguous regulatory language authoritatively — it flags ambiguity and presents the conservative read.
- It does not implement fixes — it plans them.
- It does not provide a legal opinion — the attorney does.
- It does not access Westlaw, CoCounsel, or other legal research platforms directly. It uses web_search and materials the attorney provides, with all results tagged by source tier and flagged for attorney verification.
- It does not proactively monitor for regulatory changes — it runs when the attorney invokes it.
