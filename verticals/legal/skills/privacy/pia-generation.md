---
slug: privacy.pia-generation
name: Privacy Impact Assessment Generation
practice_area: privacy
description: Structure and write a Privacy Impact Assessment (PIA) for a new feature, product, or data-processing activity, including mandatory-trigger analysis, intake questions, risk identification, and a conditions/sign-off checklist.
when_to_use: Attorney says "write a PIA," "privacy impact assessment for," "do we need a PIA for this," "privacy review this feature," or describes a new data-processing activity involving personal information.
user_invocable: true
---

## Destination check

Before producing output, confirm where this document is going. If the attorney names a destination outside the privilege circle — a vendor, a public channel, a counterparty, or company-wide distribution — flag it and offer: (a) the full privileged draft for legal review only, (b) a sanitized version suitable for the broader audience, or (c) both. Do not silently attach a work-product header and then help paste the document somewhere that header will not protect it.

## Purpose

A PIA is a structured conversation with the product or business team, captured in writing. It asks: what data, why, how long, who sees it, what could go wrong. This skill structures that conversation and writes the output in a format consistent with what the attorney has used before.

Every PIA produced by this skill is a **draft for attorney review**. It is not a legal opinion, not final advice, and not ready to rely on until the attorney signs off. The attorney owns the legal conclusion.

## Jurisdiction assumption

Unless the matter context or the attorney specifies otherwise, this assessment applies US privacy law (federal sectoral frameworks plus applicable state consumer privacy laws) with North Carolina as the default state. Surface this assumption at the top of every PIA — privacy triggers, lawful bases, and mandatory-assessment rules vary materially by jurisdiction. If the processing activity, controller location, or affected data subjects fall under a different jurisdiction (including EU/UK GDPR or another state's consumer privacy law), flag it and adjust the analysis.

## Step 0 — Does this need a PIA?

Apply the following triggers. If any applies, a PIA is warranted. If none applies, produce a one-paragraph note for the file explaining why no PIA was done.

**Mandatory-assessment triggers (research before concluding):** Several US state privacy laws (Virginia VCDPA, Colorado CPA, Connecticut CTDPA, Texas TDPSA, others) require a data-protection assessment for high-risk processing (targeted advertising, profiling with significant effects, sensitive data, selling data). GDPR/UK GDPR require a DPIA for systematic, large-scale, or high-risk processing. Research the currently operative triggers for each regime in the regulatory footprint — cite the statute or regulation with pinpoint references and tag every citation with its source (see Source attribution below). Verify currency; these rules evolve.

**Strong indicators even when not strictly mandatory:**
- New personal data categories not previously collected
- Children's data (COPPA and state analogs apply regardless of other triggers)
- Combining datasets that were collected separately
- Data that could enable discrimination
- Automated decisions with significant effects on individuals
- Processing users would not reasonably expect
- New third-party sharing or vendor relationships

If none of these applies and the attorney confirms there is no mandatory trigger → produce the file note and stop.

## Step 1 — Intake

Before drafting, get answers to these questions. Ask them conversationally — not as a form to hand off. If a matter or client is in context, ground the questions in it. If not, ask which matter this is for.

**What and why**
- What is the feature, product, or processing activity?
- What problem does it solve?
- What personal data does it touch? Be specific — "user data" is not an answer. Which fields?
- Is any of it new collection, or all reuse of existing data?
- What is the processing — storage, analysis, sharing, automated decisions?

**Who and where**
- Who inside the organization can see this data (roles, teams)?
- Any third parties — vendors, analytics, advertising partners?
- Where is it stored? Which region? Existing infrastructure or new?
- How long is it kept? Is there a deletion schedule, or does it accumulate indefinitely?

**Legal basis (research for each applicable regime)**
- Under GDPR/UK GDPR: what is the lawful basis for each purpose (contract, legitimate interests, consent, legal obligation, vital interests, public task)?
- Under CCPA/CPRA and analogous state laws: does any flow constitute a "sale," "share," or other regulated disclosure? Third-party advertising is a recurring trap — research whether it falls within the statutory definition for each applicable regime.
- Under sectoral regimes (HIPAA, GLBA, COPPA, FERPA): any regime-specific basis or disclosure rules?

Verify currency on all of the above. Flag uncertainty rather than guessing.

**What could go wrong**
- If this data leaked, what is the harm to the individual?
- Could the data be used to discriminate, even accidentally?
- Would users be surprised this is happening? (Not a legal standard, but a useful signal.)
- Is there an opt-out? Should there be?

**Firm positions:** Apply any stated firm positions on data minimization, consent standards, or retention if the attorney has provided them in this conversation. If a position is not given and the question is outcome-determinative, ask one short clarifying question rather than guessing. Flag any assumption you make.

## Step 2 — Prior work check

Before writing, note in the PIA whether there is any prior privacy work on this activity available in context (prior triage results, a prior PIA, a vendor data processing agreement review). If the attorney provides prior materials:

- Cite them and note whether this PIA supersedes or extends the prior work.
- Carry the prior risk rating as a floor — a prior high-risk finding cannot become a low-risk PIA conclusion without stating explicitly what changed and why.

If no prior work is in context, say so: "No prior triage or PIA on this activity was provided; this assessment starts fresh."

## Step 3 — Write the PIA

Present the PIA in chat for the attorney to review. Use the format below. If the attorney has shared a prior PIA or a house template, match that structure instead.

```markdown
# Privacy Impact Assessment: [Feature/Product Name]

> DRAFT — for attorney review. Not a legal opinion. Not final until signed off.

**Prepared by:** [attorney name, if provided] | **Date:** [today's date] | **Status:** DRAFT
**Product/matter:** [name] | **Privacy reviewer:** [attorney name]

---

## Jurisdiction

This assessment applies [US law / NC default / other — state explicitly]. [Flag if other jurisdictions may apply.]

---

## Executive summary

[Two sentences: what this is and whether it is okay. Example: "Feature X collects location data to enable Y. Processing is consistent with existing privacy policy commitments and uses consent as the lawful basis; two mitigations are recommended below, and no blockers are identified."]

**Overall risk:** [Attorney to set: Low / Medium / High / Very High]

---

## 1. Description of processing

**What:** [the feature or activity, in plain English]
**Data categories:** [specific fields — not "user data"]
**Data subjects:** [customers / end users / employees / etc.]
**Purpose:** [why — tied to user or business benefit]
**New collection?** [yes — these fields are new / no — reusing existing data]

---

## 2. Lawful basis

| Purpose | Regime | Basis | Notes |
|---|---|---|---|
| [purpose] | [GDPR / CCPA / HIPAA / etc.] | [Contract / LI / Consent / etc.] | [if LI: brief balancing note; if consent: how obtained and revocable?] |

---

## 3. Data flow

**Collection:** [how and where data enters]
**Storage:** [system, region, encryption at rest/in transit]
**Access:** [who, via what controls]
**Sharing:** [third parties, purpose, governed by which agreement]
**Retention:** [how long, deletion mechanism or gap]

---

## 4. Privacy policy consistency

| Policy commitment | Consistent? | Notes |
|---|---|---|
| [commitment, if policy language is provided] | Yes / Flag | [explain any mismatch] |

[If any mismatch: one of them — the policy or the processing — must change before launch.]

---

## 5. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation | Status | Owner |
|---|---|---|---|---|---|---|
| 1 | [specific risk tied to the design] | L/M/H | L/M/H | [specific control] | Done / Planned / Gap | [name or role] |

Aim for 2–5 real risks. Risks must be specific and tied to the design, not generic.

**Examples of bad vs. good risks:**

| Bad | Why bad | Better |
|---|---|---|
| "Data breach" | Applies to everything | "Location history accessible by support staff without audit logging — a malicious insider could track a user undetected" |
| "Non-compliance with GDPR" | Circular | Name the specific article and the gap |
| "Users might not like it" | Vague | "Users who opted out of marketing may still receive this because the opt-out flag is not checked in this flow" |

**Residual risk after mitigations:** [assessment]

---

## 6. Data subject rights

| Right | Exercisable? | How |
|---|---|---|
| Access | | |
| Deletion | | |
| Correction | | |
| Portability | | |
| Opt-out / Objection | | |

---

## 7. Recommendation

**[APPROVED / APPROVED WITH CONDITIONS / CHANGES REQUIRED / NOT APPROVED]**

**Conditions (if any):**
- [ ] [specific, assignable action before launch — not "improve security" but "add audit logging to admin location lookup, owner: eng lead, before launch"]

**Attorney sign-off:** _________________________ Date: _________
```

## Source attribution

Tag every legal citation in the PIA with where it came from:

- `[regulator site]` — primary source from a government or regulatory website
- `[web search — verify]` — retrieved via web search; check against the primary source before relying on it
- `[model knowledge — verify]` — recalled from training data; higher fabrication risk; verify before relying
- `[attorney provided]` — supplied by the attorney in this conversation

Do not strip or collapse these tags. They tell the reviewing attorney where to verify first.

If a web search returns few or no results on a regime's trigger rules or lawful-basis framework, say so: "Search returned [N] results for [question]. Coverage appears thin. Options: (1) broaden the search query, (2) flag as unverified and note it for attorney follow-up, or (3) proceed with a conservative default and flag the assumption." The attorney decides which path to take.

## Privacy policy diff

Every PIA should cross-check against any privacy policy language the attorney provides or has in context. Common mismatches:

- Policy lists specific data categories collected; new feature adds one not listed → policy needs updating, or stop collecting it.
- Policy says "we do not sell data"; new feature shares with an ad partner → may be a CCPA/state-law sale, research the definition.
- Policy says retention is "as long as your account is active"; new feature keeps data post-deletion → flag and resolve before launch.

Flag every mismatch. Note that one of them must change.

## Gate — submitting a DPIA to a regulator

Producing an internal PIA is research and documentation. Submitting a DPIA (or any equivalent impact assessment) to a supervisory authority, regulator, or enforcement body is the consequential act. The document becomes part of the supervisory record; material omissions or errors become enforcement exposure.

Before proceeding to any regulatory submission, stop and confirm with the attorney that the document has been reviewed and is ready for that purpose. If submission is being considered without attorney review, generate a one-page brief summarizing: the regime and regulator, why submission is being made (mandatory trigger or voluntary), the risks identified, residual risk after mitigations, flagged uncertainties, and the three questions to raise with counsel before filing.

## What this skill does not do

- It does not approve the processing. A human signs the PIA.
- It does not write a formal DPIA for submission to a supervisory authority — that is a more formal document with specific regulatory requirements; this is the internal assessment.
- It does not design the mitigation — it describes what needs mitigating; engineering or operations designs the fix.
- It does not replace a licensed attorney's review before the PIA is finalized or acted on.

## Handoff

After presenting the draft PIA, offer the following next steps and let the attorney choose:

1. **Revise the draft** — refine risks, adjust the recommendation, or add sections.
2. **Generate the conditions checklist** — extract all open conditions as a standalone task list with owners and deadlines.
3. **Draft a policy update brief** — if a privacy policy mismatch was flagged, draft the policy language change needed.
4. **Escalate for specialist review** — if the risk rating is High or Very High, or if a mandatory DPIA trigger applies, note that regulatory counsel or a DPO review may be warranted.
5. **Something else** — the attorney may redirect.
