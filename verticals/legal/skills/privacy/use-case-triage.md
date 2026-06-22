---
slug: privacy.use-case-triage
name: Privacy Use Case Triage — Data Processing Activity Assessment
practice_area: privacy
description: Quickly determine whether a new data processing activity, product feature, or vendor relationship needs a Privacy Impact Assessment, a mandatory Data Protection Impact Assessment, or can proceed — surfacing privacy policy conflicts and routing to the right next step.
when_to_use: Attorney asks "does this need a PIA," "triage this feature," "privacy check on X," "is this okay from a privacy perspective," or describes a new data processing activity, product feature, or vendor relationship.
user_invocable: true
---

# Privacy Use Case Triage

## Purpose

Answer the question that comes before anyone runs a full Privacy Impact Assessment: does this processing activity even need one? And if so, what kind, and what is blocking the way?

Triage is faster than PIA generation but upstream of it. It does not write the assessment — it determines whether one is needed and on what terms. The PIA generation skill does the deep work.

The output is one of four classifications:

- **PROCEED** — No PIA needed. Standard safeguards apply.
- **PIA REQUIRED** — Assessment needed before or alongside deployment.
- **DPIA MANDATORY** — A regime-mandated Data Protection Impact Assessment is required (cite the applicable regime's trigger and primary sources). Harder bar; privacy counsel or DPO involvement likely.
- **STOP** — Processing activity conflicts with the privacy policy or has no lawful basis as described. Needs redesign before proceeding.

## Guardrails

Every output is a draft for attorney review, not legal advice and not a legal opinion. The attorney owns the legal conclusion. Present findings in chat for the attorney to review and save in the matter if they choose.

**Privilege and destination check.** Before producing output, consider where it is going. If the attorney names a destination outside the privilege circle (a public channel, a counterparty, a vendor, the client for work product), flag it and offer: (a) the privileged version for legal-only circulation, (b) a sanitized version for the broader audience, or (c) both. Do not silently attach a privileged header and then help paste the content somewhere it will not be protected.

## Jurisdiction assumption

Default to North Carolina law and US federal sectoral baselines unless the attorney specifies otherwise. Privacy rules, assessment triggers, and lawful bases vary materially by jurisdiction (GDPR vs. US state consumer privacy laws vs. sectoral). If the processing activity, controller, or affected data subjects fall under a different jurisdiction, surface that assumption explicitly and note that the classification may not apply as written.

## Matter context

If a matter or client is in your context, ground the triage in it. If not, ask which matter or client this relates to — or confirm the attorney wants a practice-level triage with no specific matter.

If the attorney has provided firm-specific privacy policy commitments, regulatory footprint, or risk appetite in your context, apply those as authoritative. If a position is not provided, ask one short question or apply a conservative default and flag the assumption explicitly. Never invent firm-specific positions as authoritative.

## Triage process

### Step 1: Understand the activity

If the description is vague, ask before classifying. Get specific on:

- What data is being collected or processed? Which categories?
- Who are the data subjects — customers, employees, third parties?
- What is the purpose? What problem is this solving?
- Is this new data collection, or repurposing data already held?
- Is a third-party vendor involved? New vendor or existing?
- Is any automated decision-making involved — does the output affect anyone?
- What is the deployment context — internal only, customer-facing, public?

"New feature" and "data processing activity" are not enough to triage accurately.

---

### Step 2: Check house triggers

If the attorney has provided PIA trigger criteria in your context (firm risk appetite, regulatory footprint, internal policy), apply them.

If no trigger criteria are provided, apply these conservative defaults and flag the assumption:

- Any collection of sensitive categories (health, financial, biometric, children's data, precise location, government ID)
- Any new third-party vendor receiving personal data
- Any automated decision-making that affects individuals
- Any novel use of data beyond the purpose it was originally collected for
- Any large-scale processing of personal data

If the house trigger is met → at minimum **PIA REQUIRED**.

If the house trigger is not met, continue to Step 3 before concluding PROCEED.

---

### Step 3: Mandatory assessment check

**Check federal sectoral overlays first.** If the processing touches a federally-regulated data category, the federal overlay is usually the controlling framework, not state privacy law. Surface this before applying any state-level analysis.

> **Activity-based federal overlays — check first:**
>
> Does this processing touch:
> - **Financial account data or nonpublic personal information about consumers** (GLBA / Reg P — applies to financial institutions and their non-affiliated third parties; imposes substantive restrictions on sharing NPI for marketing, separate from and on top of any state privacy-law exemption)?
> - **Protected health information held by a covered entity or business associate** (HIPAA Privacy / Security Rules — substantive restrictions on use and disclosure, breach notification at 500+ records, BAA required for any vendor)?
> - **Education records held by a school or a service provider acting for a school** (FERPA — consent requirements for disclosure, directory-information carve-outs)?
> - **Data from children under 13 collected by an operator of an online service directed to children or with actual knowledge** (COPPA — parental consent, notice, deletion rights, strict limits on retention and sharing)?
> - **Another sectoral federal regime** (e.g., VPPA for video-viewing records, CPNI for carrier data, DPPA for DMV records, TCPA for SMS/call consent)?
>
> If yes to any: the federal overlay usually supplies the controlling substantive restriction. An activity that is "exempt" from a state consumer privacy law (e.g., CCPA § 1798.145(e) for GLBA-covered data) is still subject to the federal restrictions (e.g., GLBA § 6802(a)-(c) on NPI sharing) — the state exemption does not make the activity lawful; it just moves the governing framework to the federal regime.

For any applicable regime (federal or state) in the attorney's regulatory footprint, use web_search and any sources or documents the attorney provides to research the currently operative mandatory privacy/data-protection assessment triggers. Cite controlling statute, regulation, or regulator guidance with pinpoint references. Note effective dates — regulators update trigger lists regularly; do not rely on a static checklist. Flag uncertainty for attorney verification rather than guess.

If **any** applicable regime's mandatory trigger is met → **DPIA MANDATORY** (or the equivalent regime-specific mandate), regardless of house trigger.

**Strong indicators (not necessarily mandatory, but warrant a PIA regardless):**
- New technology or novel use of existing technology
- Children's data
- Combining datasets not collected together
- Data that could enable discrimination
- Processing users would not expect
- Lookalike audiences, cross-context behavioral advertising, or tracking-based ad-tech activity

One or more strong indicators with no researched mandatory trigger → escalate to **PIA REQUIRED**.

---

### Step 4: Privacy policy conflict check

If the attorney has provided privacy policy commitments in your context, check the proposed activity against every stated commitment.

**Common conflicts to catch:**
- Policy describes what data is collected — this activity collects something not listed. Policy update needed before launch, or stop collecting it.
- Policy says "we don't sell or share data with third parties" — this activity passes data to a vendor for their own purposes. Research whether the flow constitutes a regulated "sale," "share," or other disclosure category.
- Policy states retention limits — this activity retains data longer.
- Policy says data is used only for a stated purpose — this activity uses it for a new purpose without fresh consent or legitimate interest assessment.
- Policy specifies user rights offered — this activity creates a new data category the rights process was not built for.

If a direct conflict exists → **STOP**. Not "proceed with caution" — the policy conflict must be resolved (policy update or activity redesign) before this proceeds.

If no privacy policy is provided in context, note the assumption and flag that a policy review is a condition of any PROCEED or PIA REQUIRED outcome.

---

### Step 5: Classification and output

Present the result in chat for the attorney to review.

---

**ACTIVITY:** [State the processing activity as understood]

**CLASSIFICATION:** [PROCEED / PIA REQUIRED / DPIA MANDATORY / STOP]

**House trigger met?** [Yes / No / Using conservative defaults — flag assumption]
**Mandatory DPIA trigger?** [Yes — cite trigger and source / No / Needs research — flag]
**Privacy policy conflict?** [None / Yes — specific conflict / No policy provided — flagged]

**Reasoning:**
[1–3 sentences. For PROCEED: what makes it safe under current policy. For PIA/DPIA: what creates the obligation. For STOP: which specific policy commitment or principle is in conflict.]

**Jurisdiction applied:** [e.g., North Carolina / US federal sectoral — HIPAA / GDPR if in footprint] **[ASSUMPTION — confirm if different]**

---

*If PIA REQUIRED or DPIA MANDATORY — conditions before proceeding:*

| Requirement | Owner | Done? |
|---|---|---|
| Privacy Impact Assessment | Privacy counsel | ☐ |
| Legitimate interest assessment (if LI basis claimed) | Privacy counsel | ☐ |
| DPO or GC consultation (DPIA mandatory track) | DPO / GC | ☐ |
| Vendor Data Processing Agreement in place | Privacy / Legal | ☐ |
| Privacy policy update before launch | Privacy counsel | ☐ |
| Consent mechanism built and tested | Product / Legal | ☐ |
| Data subject rights process covers new data category | Privacy / Product | ☐ |

**Lawful basis (if GDPR in footprint):** [Consent / Contract / Legitimate Interest / Legal Obligation — or "unclear — needs determination in PIA"]

After presenting a PIA REQUIRED or DPIA MANDATORY result, offer:

> "Want me to start the PIA now? I can run the intake questions and produce the assessment document in this conversation."

---

*If STOP:*

**Conflict:** [Specific privacy policy commitment or principle in conflict]

**To proceed, one of these must change:**
- [Option A — redesign the activity so it does not create the conflict]
- [Option B — update the privacy policy to cover this processing, which itself requires a review of whether the update is consistent with lawful basis]

Do not offer a path forward if there is not one. If the processing cannot be reconciled with stated commitments or lawful basis, say so plainly.

---

### Step 6: AI governance handoff

If the activity involves an AI system making or influencing decisions about individuals, flag it:

> "This activity involves AI decision-making. An AI impact assessment may be required in addition to a PIA — they are not substitutes. Ask me to run an AI impact assessment on this activity if you would like to assess it in parallel."

Only flag this handoff when it is actually relevant.

---

## Batch triage

If the attorney presents a feature list, roadmap, or backlog, produce a summary table first, then expand each non-PROCEED entry:

| # | Activity | Classification | Key condition / blocker |
|---|---|---|---|
| 1 | [activity] | PROCEED | — |
| 2 | [activity] | PIA REQUIRED | Lawful-basis assessment needed; vendor DPA not in place |
| 3 | [activity] | DPIA MANDATORY | Large-scale special category data |
| 4 | [activity] | STOP | Privacy policy conflict — purpose limitation |

---

## Edge cases and failure modes

**"It's anonymized" does not automatically mean PROCEED.**
Ask how it is anonymized and whether re-identification is realistically possible given the dataset. Pseudonymized data is still personal data under GDPR. Apply web_search or attorney-provided sources to confirm the standard in the applicable regime.

**"We already do something similar" is not a triage.**
Existing processing that was never assessed does not grandfather new processing. If the new activity is materially different in scale, purpose, or data category, triage it fresh.

**"Just a pilot" does not skip triage.**
A pilot that touches real user or employee data is subject to the same triggers. Apply the same classification; if a PIA is required, the pilot should have one.

**"The vendor handles all the privacy."**
The vendor handles the infrastructure. The firm's client is still the controller determining the purposes. If personal data flows to the vendor, a Data Processing Agreement is required and triage still applies to the purpose.

**Inferred data and derived attributes count.**
If the activity generates inferred data about individuals (e.g., a behavioral score, a predicted preference), treat the inferred attribute as personal data for triage purposes. "We are just computing a score" does not change what the score represents.

---

## Next steps

End every triage with a short decision tree tailored to what this triage produced. Customize the branches to the actual classification — do not paste a generic template. The attorney picks the branch; you execute it.

Typical branches after a non-PROCEED result:
- Start the PIA now in this conversation
- Escalate to privacy counsel or DPO before proceeding
- Redesign the activity to remove the trigger (STOP result)
- Get more facts before classifying (if the activity description was too vague)
- Watch and wait — note the conditions and revisit when the activity moves forward
