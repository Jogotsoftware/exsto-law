---
slug: privacy.policy-monitor
name: Privacy Policy Monitor
practice_area: privacy
description: Detect drift between a client's published privacy policy and their actual data practices by scanning recent Privacy Impact Assessments, Data Processing Agreements, triage results, or a described proposed new practice, then drafting suggested policy language for each gap.
when_to_use: When the attorney or client asks whether the privacy policy covers a proposed new practice, wants to find where the policy no longer matches what the business actually does, or asks for a policy gap check, policy sweep, or policy update review.
user_invocable: true
---

# Privacy Policy Monitor

## Purpose

Privacy policies drift from practice in one direction: practice moves forward, policy stays behind. A Privacy Impact Assessment (PIA) approves a new data category. A Data Processing Agreement (DPA) is signed with a subprocessor not listed anywhere. A triage result marks a new use case conditional on a disclosure requirement the policy has not yet made. Months later, someone reads the policy and it does not reflect what actually happens.

This skill catches the drift before it becomes a problem — either by reviewing recent outputs the attorney provides, or by answering the direct question: "we are about to start doing X, what does that mean for the policy?"

The output is always the same: here is the gap, here is the suggested language.

> **Every output from this skill is a draft for attorney review. Nothing here is legal advice or a legal opinion. The attorney reviews and approves every suggested change before any policy is updated, published, or relied on.**

---

## Jurisdiction assumption

Default to **North Carolina / US law** when no jurisdiction is stated. Surface that assumption explicitly. Many US privacy obligations are federal (FTC Act, GLBA, HIPAA, COPPA, VPPA) or state-specific (NC Identity Theft Protection Act; and as of 2025, the **North Carolina Consumer Privacy Act (NCDPA)** enacted and in effect). If the client operates across states or handles EU/UK data subjects, flag the additional regimes and ask the attorney to confirm scope before treating the analysis as complete.

---

## Two modes

**Sweep mode** — when the attorney provides a set of recent documents (PIAs, DPAs, triage results, DSAR responses) and asks for a comprehensive gap check against the current policy.

**Direct query mode** — when the attorney or client describes a single proposed new practice and wants to know whether the policy needs updating before that practice goes live.

If it is unclear which mode is intended, ask one short question: "Are you checking a specific proposed practice, or reviewing a set of recent documents against the current policy?"

---

## What you need before starting

Ask the attorney to provide, or confirm what is in the current matter context:

1. **The current privacy policy** (full text, or a link the attorney can paste). The full text is authoritative — do not rely on a summary.
2. **The regulatory footprint** — which regimes apply: GDPR, CCPA/CPRA, NCDPA, GLBA, HIPAA, FERPA, COPPA, VPPA, CPNI, other sectoral. If not stated, ask; do not assume a clean footprint.
3. **For sweep mode:** the documents or summaries of outputs to review (PIAs, DPAs, triage results, DSAR responses — paste text, attach, or describe them).
4. **For direct query mode:** a plain-language description of the proposed new practice.

If the firm has stated privacy positions (e.g., "our standard is to never sell client data," "we maintain a named subprocessor list") and those appear in the matter context or firm settings, apply them. If a relevant firm position is not stated, flag the gap and ask one short question — or apply a conservative default and label it explicitly as an assumption.

---

## Regulatory footprint — sweep all commitment surfaces

The website privacy policy is one surface. Modern privacy programs make binding commitments in at least four more places regulators actively scrutinize for inconsistencies. When the attorney provides access to information about these surfaces, check them too:

1. **Cookie consent banners / Consent Management Platforms (CMPs).** The CMP promises specific cookie categories and purposes. If the privacy policy says "we use analytics cookies" and the CMP offers "strictly necessary only," that is a conflict. EU Data Protection Authorities and the FTC have both enforced against CMP misconfigurations.
2. **App store privacy labels.** Apple App Privacy ("nutrition label") and Google Data Safety are self-declared and FTC-enforceable. A policy update without a matching app store label update is a regulator-visible inconsistency. Note the label's last-updated date and whether it matches the current policy's data categories, purposes, and sharing disclosures.
3. **In-product consent flows.** The actual screens where users make data-use choices (onboarding consents, settings toggles, "updated policy" dialogs). The policy says what the company does; the consent flow says what the user agreed to. They should match.
4. **Sector-specific notices.** GLBA privacy notices, HIPAA Notices of Privacy Practices, FERPA directory notices, COPPA direct notices. These have independent update obligations and their own consistency requirements with the general privacy policy.

**If a surface's last-updated date is available and predates a recent policy change**, flag it: "Privacy policy updated [date]. App Store label last updated [earlier date] — may not reflect the new data category. Verify and update before launch."

---

## Sectoral notices — sweep these in addition to the website policy

If the regulatory footprint includes any of the following, diff the practice against the corresponding sectoral notice — or flag its absence as a standing gap:

| Footprint entry | Sectoral notice | What to flag |
|---|---|---|
| **GLBA / Reg P** (financial institution handling NPI) | GLBA initial + annual privacy notice (12 C.F.R. Part 1016 or functional-regulator equivalent) | New NPI categories, sharing with non-affiliated third parties, or changes to opt-out mechanics not reflected in the Reg P notice. A DPA with an analytics vendor receiving NPI with no matching Reg P notice update is a gap. |
| **HIPAA** (covered entity or business associate) | Notice of Privacy Practices (45 C.F.R. § 164.520) | New uses or disclosures, new routine categories, or changes to patient-rights mechanics. A BAA signed with a new subcontractor flowing PHI with no matching NPP refresh is a gap. |
| **FERPA** (school or school service provider) | Annual directory-information / rights notice (34 C.F.R. § 99.37) | New disclosure categories to service providers under the school-official exception, new directory-information elements, or changes implicating parental-consent flow-through. |
| **COPPA** (operator directed to children under 13) | Direct notice to parents + online notice (16 C.F.R. § 312.4) | New data categories collected from children, new third-party disclosures, or changes to verifiable-parental-consent mechanics. |
| **NCDPA** (NC businesses meeting thresholds) | Privacy notice required under the NCDPA | Consumer rights (access, correction, deletion, portability, opt-out of sale/targeted advertising/profiling), sensitive data categories, and opt-in consent where required. |

**If no sectoral notice is configured or provided for a regime in the footprint**, surface this as a standing gap — do not silently default to diffing only against the website policy. Say so explicitly: "Your footprint includes [regime] but no sectoral notice was provided. This analysis covers only the website privacy policy. A [GLBA notice / HIPAA NPP / etc.] should also be reviewed and is flagged as a standing gap."

**If the footprint is ambiguous** — for example, the stated footprint says "CCPA/NCDPA" but the documents reference PHI, NPI, or student data categories — surface the footprint-vs-practice mismatch before proceeding: "The stated footprint does not list [GLBA / HIPAA / FERPA / COPPA] but this review involves [category]. Should this regime be added to the footprint, and is there a sectoral notice to review?"

---

## Mode 1: Sweep

### What to read in each document type

**PIAs (Privacy Impact Assessments):**
Extract: data categories processed, purposes, third parties and subprocessors, retention periods, user rights implications, any conditions placed on the processing. Flag anything in that list not present in the current privacy policy.

**DPA reviews (signed or approved):**
Extract: subprocessors added, data locations agreed to, processing purposes covered, any obligations to data subjects created by the DPA terms. Flag subprocessors not listed in the policy (if the policy names them), new processing categories, new data locations, obligations inconsistent with policy.

**Triage results (PIA REQUIRED / PROCEED outcomes):**
Extract: what was approved, any conditions imposed that imply a public commitment (e.g., "disclosure to affected parties required before launch"). Flag approved practices not covered by policy, and conditions that require policy language.

**DSAR responses:**
Extract: any new data categories surfaced that were not in previous responses, any systems added to the systems inventory. Flag data categories collected but not disclosed in the policy.

### Gap classification

For each flagged item, assess:

**REQUIRED update** — the policy makes a commitment this output contradicts, or the processing is occurring and the policy has no coverage at all. Not updating creates a material misrepresentation.

> Example: Policy says "we collect name, email, and payment information." A PIA approved collection of location data. Policy says nothing about location. REQUIRED update — the company is collecting data it has not disclosed.

**ADVISABLE update** — the policy is silent but not in conflict. The processing is defensible without updating, but cleaner with it.

> Example: Policy says "we may share data with service providers." A DPA was signed with a new analytics vendor. The policy does not name the vendor but does not exclude them either. Advisable to add to a named subprocessor list if one is maintained.

### Sweep output format

Present this in chat for the attorney to review.

```
# Privacy Policy Monitor — Sweep Report

**Date:** [date]
**Documents reviewed:** [list]
**Gaps found:** [N] REQUIRED | [N] ADVISABLE

---

## REQUIRED updates

### [Gap short name]

**Source:** [document / output that triggered this]
**What is happening:** [plain description of the new practice]
**Current policy:** [quote the relevant section — or "No coverage"]
**Gap:** [what is missing or inconsistent]

**Suggested language:**
> *Add to [section name]:*
> "[Drafted policy text — specific, consistent with the voice and style of the actual policy]"

---

[Repeat for each REQUIRED gap]

---

## ADVISABLE updates

### [Gap name]

**Source:** [document]
**What is happening:** [description]
**Current policy:** [quote or "Silent"]
**Suggested language:**
> *Add to / update [section]:*
> "[Drafted text]"

---

## No action needed

[List documents reviewed where no gaps were found — confirms they were reviewed]

---

## Next steps

- [ ] Review REQUIRED updates — each needs a decision before the associated feature or processing goes live (or immediately if already live)
- [ ] Review ADVISABLE updates — lower urgency, address at next policy refresh
- [ ] Confirm sectoral notices are current (see gaps flagged above, if any)
```

---

## Mode 2: Direct query

### Parse the proposed practice

Extract from the attorney's description:
- What data is being collected or processed?
- What is the purpose?
- Who else is involved (vendors, partners, third parties)?
- Who are the data subjects?
- Is there any automated decision-making or profiling?
- Is any new disclosure to data subjects required?

If the description is vague, ask one clarifying question before proceeding. This mode should be fast — do not run a long intake.

### Policy diff

Check the proposed practice against every relevant section of the current policy:

| Check | Current policy says | Proposed practice | Verdict |
|---|---|---|---|
| Data categories | [what policy lists] | [new category if any] | Covered / Gap / Conflict |
| Purposes | [stated purposes] | [new purpose] | |
| Third parties / subprocessors | [stated parties] | [new party if any] | |
| Retention | [retention commitment] | [implied retention] | |
| User rights | [rights offered] | [new rights implications] | |
| Disclosure / notice | [what policy says about telling users] | [what this practice requires] | |

### Direct query output format

Present this in chat for the attorney to review.

```
# Privacy Policy Check: [Proposed practice in one line]

**Bottom line:** [POLICY UPDATE REQUIRED / ADVISABLE / NO UPDATE NEEDED]

---

## What is covered

[List aspects of the proposed practice already addressed by the current policy]

## What is missing

### [Gap 1]

**Current policy:** [quote or "Silent"]
**What is needed:** [why this gap matters — legal, reputational, or consistency reason]

**Suggested language:**
> *Add to [section]:*
> "[Drafted text]"

## What conflicts

### [Conflict 1 — if any]

**Current policy says:** [quote]
**Proposed practice does:** [what conflicts]
**Resolution:** [which one needs to change and why — usually the practice adjusts to match the policy, or the policy gets updated to a defensible new position]

---

## Timing

[If any gap is REQUIRED: "Policy update should happen before this goes live."
If ADVISABLE: "Can proceed; update at next policy refresh."]
```

---

## Suggested language quality standards

Policy language should:
- Match the voice and style of the existing policy. Read the full policy text, not a summary, before drafting.
- Be specific enough to be meaningful but not so specific that routine changes break it ("service providers who assist us in operating our business" ages better than naming every vendor).
- Not make commitments the client cannot keep (do not draft "we will never share location data" if the architecture has that data flowing to an analytics vendor).
- Flag where a broader policy position change may be needed, not just a sentence addition.

Always specify which section to add to. If the right section does not exist, say so and suggest creating it.

---

## What this skill does not do

- **Does not update the policy.** It drafts suggested language and flags decisions, but the attorney reviews and approves every change.
- **Does not catch regulatory changes.** This skill monitors internal practice drift, not external legal changes (e.g., new state privacy laws, FTC rule updates). For regulatory gap analysis, that is a separate task.
- **Does not access external legal research platforms.** If case law or regulatory guidance would sharpen a gap analysis, use web_search with the attorney's guidance, and note the limits of what web search can surface versus a subscription research service.
- **Does not read emails, Slack, or informal communications.** Only structured documents or descriptions the attorney provides.
- **Does not make the legal conclusion.** The attorney owns the conclusion on whether a gap is material, whether a particular update is legally required, and what language is acceptable. This skill provides the analysis and drafts; the attorney decides.

---

## Close with next steps

End every output with a short decision tree for the attorney:

1. **Revise the policy now** — if any REQUIRED gaps were found and the practice is live or going live soon.
2. **Queue for next policy refresh** — if gaps are ADVISABLE only and the practice is not yet live.
3. **Adjust the practice to fit the current policy** — sometimes easier than updating the policy.
4. **Escalate or get outside counsel input** — if a conflict involves a regulated data category (health, financial, children's) or the footprint is unclear.
5. **Something else** — describe it and I will help.

If the sweep surfaced more than approximately 10 drift findings, offer to present a summary table organized by severity and policy section to make triage easier.
