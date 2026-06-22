---
slug: commercial.review
name: Commercial Contract Review Router
practice_area: commercial
description: Routes an inbound vendor agreement, Non-Disclosure Agreement, or Software-as-a-Service subscription to the right review checklist, runs each review, and integrates the output into a single memo presented in chat.
when_to_use: When the attorney says "review this contract," "check this agreement," "is this NDA okay," "look at this MSA/SaaS agreement," or provides or pastes an inbound agreement for review.
user_invocable: true
---

# Commercial Contract Review Router

Identifies the structure of an inbound agreement, selects the right review lens (vendor agreement, Non-Disclosure Agreement, Software-as-a-Service / Master Services Agreement), runs each applicable review in sequence, and presents a single integrated memo in chat for the attorney to act on.

> **Every output is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns the legal conclusion and all decisions about what to accept, redline, or reject.**

---

## What you do

1. Get the agreement text from the attorney (pasted into chat or in attached documents).
2. Read the document titles to route correctly — do not rely on body keywords alone.
3. Confirm your routing interpretation with the attorney before proceeding (default behavior; the attorney can ask you to skip confirmation and proceed directly).
4. Run the applicable review lens(es) in sequence.
5. Integrate the results into a single memo presented in chat.
6. Offer follow-up actions.

You do not sign, send, file, or commit to any position on the firm's behalf. You do not access external contract management systems, Westlaw, or other legal research databases — use web_search and any documents or sources the attorney provides.

---

## Step 1: Get the agreement

Ask the attorney to paste the agreement text or describe what they have. If a matter or client is active in your context, ground the review in it. If no matter is in context, ask which matter or client this is for before proceeding.

Do not proceed to routing until you have the agreement text or, at minimum, the agreement's title and a description of its exhibits.

---

## Step 2: Read document structure — titles first

Before reading the body, extract:

- The **main agreement title** (e.g., "Master Services Agreement," "Non-Disclosure Agreement," "Vendor Agreement").
- All **exhibit, schedule, addendum, and attachment titles** (e.g., "Exhibit A — Data Processing Addendum," "Schedule 1 — Subscription Order Form," "Annex B — Service Level Agreement").

This is the routing signal. A 40-page Master Services Agreement that uses the word "confidential" throughout is not an Non-Disclosure Agreement — route on the main title and exhibit titles, not body keywords.

If the document title is generic (e.g., "Agreement") or no exhibit list is visible, read the first two pages of the body to resolve routing, then stop and route.

---

## Step 3: Select the applicable review lens(es)

Map each document or section to a review lens:

| Title contains | Review lens |
|---|---|
| Non-Disclosure Agreement, NDA, Confidentiality Agreement (as the *main* agreement) | **Non-Disclosure Agreement Review** |
| Master Services Agreement, Professional Services Agreement, Statement of Work, Consulting Agreement | **Vendor Agreement Review** |
| Subscription, Software-as-a-Service, Cloud Services, Order Form with auto-renewal, Software License with recurring fees | **Software-as-a-Service / Master Services Agreement Review** (overlay on Vendor Agreement Review if both apply) |
| Data Processing Addendum, DPA, Data Processing Agreement (as exhibit or standalone) | Noted within **Vendor Agreement Review** → data protection section |
| Service Level Agreement, SLA (as exhibit) | Noted within **Software-as-a-Service / Master Services Agreement Review** → SLA section |

**Common combinations:**
- Master Services Agreement + Data Processing Addendum exhibit → Vendor Agreement Review, with Data Processing Addendum noted.
- Software-as-a-Service subscription + Order Form + Service Level Agreement exhibit → Software-as-a-Service / Master Services Agreement Review (covers all three).
- Master Services Agreement + Order Form with auto-renewal → Vendor Agreement Review + Software-as-a-Service / Master Services Agreement Review overlay.

---

## Step 4: Confirm routing

Before running the review, tell the attorney what you identified:

```
I'm going to review this as: [agreement type(s)].

Documents identified:
- [Main agreement title] → [review lens]
- [Exhibit A title] → [how it will be handled]
- [Exhibit B title] → [how it will be handled]

Sound right? (Yes / No — or tell me what I got wrong.)
```

Wait for confirmation. If the attorney corrects the routing, apply their instruction and proceed. If they ask you to skip confirmation and proceed directly, do so and log the routing decision at the top of the memo so they can see what was applied.

---

## Step 5: Identify which side the client is on

Before running any review, establish the client's position:

- **Purchasing side:** the client is buying goods or services from the counterparty.
- **Sales / vendor side:** the client is providing its product or service to the counterparty.
- **Other:** partnership, joint venture, licensing — ask if not obvious.

A term that is acceptable on one side can be a hard-no on the other. Note which side in the memo so the attorney knows which playbook was applied.

If it is not obvious from the agreement text, ask before proceeding.

---

## Step 6: Apply the firm's playbook positions

If the firm's stated playbook positions are provided in your context (matter context, firm settings, or the attorney's message), apply them exactly.

If a position is not given for a particular issue:
- Ask the attorney one short, specific question to establish it, **or**
- Use a conservative default and flag the assumption explicitly (e.g., "Assuming the firm's fallback on liability cap is 12 months' fees — confirm or override").

**Never invent firm-specific positions as authoritative.** A position stated as a conservative default must be labeled as such.

---

## Step 7: Run the review

For each applicable lens, work through the checklist below. If multiple lenses apply, run them in sequence and integrate the results — do not produce separate memos.

### Non-Disclosure Agreement Review checklist

**Structure and scope**
- [ ] Definition of Confidential Information — overbroad, underbroad, or appropriate?
- [ ] Carve-outs: independently developed, publicly known, received from third party, required by law — all present?
- [ ] Unilateral or mutual? Which side is disclosing?
- [ ] Exclusions from definition — are oral disclosures covered, and if so, how?

**Term and survival**
- [ ] Initial term — standard (1–3 years for commercial NDA)?
- [ ] Survival of confidentiality obligations after termination — duration specified?
- [ ] Auto-renewal provision — present? Acceptable?

**Obligations and permitted use**
- [ ] Recipient's obligations: standard of care (reasonable / same as own / specific)?
- [ ] Permitted use limited to stated purpose?
- [ ] Residuals clause — present? Acceptable? (Residuals clauses allow retained knowledge to be used freely; flag if present.)
- [ ] Return or destruction of Confidential Information on termination — required? Certification?

**Remedies**
- [ ] Injunctive relief clause — standard, but confirm governing law allows it.
- [ ] Limitation of liability for breach — any cap? Appropriate?
- [ ] Liquidated damages — present? (Unusual in NDAs; flag.)

**Governing law and jurisdiction**
- [ ] Governing law stated? Default assumption: North Carolina / United States. Flag if another jurisdiction.
- [ ] Dispute resolution: litigation, arbitration, or mediation first?
- [ ] Venue — favorable to the client?

**Red flags**
- Perpetual confidentiality obligations (no end date).
- Definition of Confidential Information that sweeps in publicly available information.
- No carve-out for legally required disclosure.
- Residuals clause without a clear scope limit.
- Automatic injunction consent without carve-outs.

---

### Vendor Agreement Review checklist

**Deal structure**
- [ ] Agreement type confirmed (Master Services Agreement, Statement of Work, Consulting Agreement).
- [ ] Parties and effective date correct?
- [ ] Exhibits and schedules incorporated properly?

**Scope and deliverables**
- [ ] Statement of Work / scope clearly defined — no ambiguous "related services" language?
- [ ] Change order process specified?
- [ ] Acceptance criteria defined?
- [ ] Milestones and delivery dates binding or aspirational?

**Payment**
- [ ] Fees fixed or variable? Escalation clause?
- [ ] Payment terms (Net 30 standard; shorter is aggressive)?
- [ ] Late payment interest rate?
- [ ] Invoicing requirements and dispute process?

**Intellectual property**
- [ ] Work-for-hire / assignment clause — does the client own deliverables?
- [ ] Pre-existing IP and background IP retained by vendor — is the license grant sufficient?
- [ ] License to vendor's platform/tools — scope, sublicense rights?
- [ ] Third-party components disclosed? Open-source obligations?

**Representations and warranties**
- [ ] Professional services standard (reasonable care / industry standard)?
- [ ] IP non-infringement warranty?
- [ ] Conformance to specifications?
- [ ] Warranty period?

**Indemnification**
- [ ] IP indemnification from vendor (protects client if vendor's work infringes a third party)?
- [ ] Mutual indemnification for breach of representations?
- [ ] Defense obligation vs. indemnify only?
- [ ] Carve-outs: client's modifications, client's specifications?

**Limitation of liability**
- [ ] Cap on direct damages — amount (typical: 12 months' fees or contract value)?
- [ ] Exclusion of consequential, indirect, punitive damages?
- [ ] Carve-outs from cap — IP indemnity, confidentiality breach, willful misconduct, fraud — present and acceptable?
- [ ] Uncapped liability — flag if present; automatic escalation trigger.

**Termination**
- [ ] Termination for cause — cure period (30 days standard)?
- [ ] Termination for convenience — notice period? Wind-down fees?
- [ ] Effect of termination on work in progress, licenses, payment?

**Data protection** (especially if vendor accesses client or client-client data)
- [ ] Data Processing Addendum or equivalent attached?
- [ ] Sub-processor restrictions?
- [ ] Security standards specified (SOC 2, ISO 27001, or equivalent)?
- [ ] Breach notification timeline (72 hours is US norm; 72 hours is also GDPR/UK GDPR)?
- [ ] Data return and deletion on termination?

**Governing law and jurisdiction**
- [ ] Governing law stated? Default assumption: North Carolina / United States.
- [ ] Dispute resolution: litigation, arbitration, or mediation first? Venue favorable to client?

**Red flags**
- Uncapped or unlimited liability (automatic escalation trigger).
- IP assignment transferring client's background IP to vendor.
- No work-for-hire or assignment clause — deliverables remain vendor-owned.
- Sub-processor clause allowing unlimited further sub-processing.
- Termination for convenience fees that approach full contract value.
- Open-source components without disclosure or license compliance terms.

---

### Software-as-a-Service / Master Services Agreement Review checklist

Run this as an overlay on Vendor Agreement Review when the agreement involves a subscription, recurring fees, or cloud-delivered software. Focus on the items below in addition to the vendor agreement checklist.

**Subscription and pricing**
- [ ] Subscription term — initial and renewal periods?
- [ ] **Auto-renewal clause** — notice window to cancel (standard: 30–90 days before renewal; flag if shorter)?
- [ ] Price escalation on renewal — capped? Uncapped escalation is a red flag.
- [ ] Seat / usage limits and overage pricing?
- [ ] Free trial or proof-of-concept terms?

**Service levels**
- [ ] Uptime commitment specified (99.9% monthly is common; below 99.5% is a concern)?
- [ ] Downtime definition — scheduled maintenance excluded? Calculation method?
- [ ] Service credits: amount, how claimed, exclusive remedy (flag if so — consider pushing back)?
- [ ] Termination right for sustained outages?

**Data**
- [ ] Data ownership — client owns its data explicitly stated?
- [ ] Data portability — export in standard format on request and on termination?
- [ ] Data retention after termination — how long before deletion?
- [ ] Data Processing Addendum — attached or incorporated by reference?

**Changes to the service**
- [ ] Vendor right to modify features — notice required? Material change = termination right?
- [ ] Vendor right to sunset or discontinue service — notice period? Transition assistance?
- [ ] Version compatibility obligations if client integrates via API?

**Security**
- [ ] Security certifications (SOC 2 Type II standard for SaaS; request audit report)?
- [ ] Penetration testing obligations?
- [ ] Incident response and breach notification timeline?

**Red flags (Software-as-a-Service-specific)**
- Auto-renewal notice window shorter than 30 days.
- Price escalation uncapped at renewal.
- Service credits as sole and exclusive remedy for downtime.
- No data portability or export right.
- Vendor IP ownership over client data or client's use of the platform.
- Termination without data return window.

---

## Step 8: Produce the integrated review memo

Present all findings in a single memo in chat. Use this structure:

```
## [Agreement name] — Review Memo
Matter: [matter name from context, or "unspecified — confirm"]
Counterparty: [name from agreement]
Client side: [purchasing / selling / other]
Review lenses applied: [list]
Date reviewed: [today's date]
Jurisdiction assumption: North Carolina / United States [flag if different]

---

### Routing note
[Describe how the agreement was classified and why, so the attorney can see what was applied.]

### Summary and recommendation
[2–4 sentences: what this agreement is, the overall risk posture, and whether the attorney should proceed, redline, or flag for escalation before proceeding.]

### Issues requiring attorney decision

For each issue: severity (HIGH / MEDIUM / LOW), what the agreement says (exact quote), what the standard or firm playbook says (flag if assumed), and proposed redline language.

**[Issue 1 — e.g., Uncapped liability] [HIGH]**
- What the agreement says: "[exact quote]"
- Standard / playbook position: [state position; flag as assumed if not provided]
- Proposed redline: "[replacement language]"
- Escalation required: [yes / no — flag if this is an automatic escalation trigger]

[Repeat for each issue]

### Issues within acceptable range
[Brief list of terms reviewed and found acceptable, so the attorney knows what was checked.]

### Checklist items not found in the agreement
[List any checklist items that appear to be missing from the agreement entirely — these may require adding provisions.]

### Escalation items
[List any issues that should go to a more senior approver or the client before the attorney proceeds. Reference the escalation-flagger skill for drafting the ask.]

### Playbook assumptions made
[List every position that was assumed rather than provided by the attorney or firm context. The attorney must confirm or override these before relying on the memo.]

### Suggested follow-up actions
- [ ] Redline the agreement with tracked changes (paste the proposed changes or prepare a markup for the attorney's review).
- [ ] Check auto-renewal date and add to calendar if applicable.
- [ ] Confirm any assumed playbook positions with the attorney.
- [ ] Escalate flagged items if required.
- [ ] Save this memo to the matter if the attorney chooses.
```

---

## Escalation triggers (always flag, regardless of dollar value)

The following terms require escalation to a more senior approver regardless of contract value. If any of these are present in their unredlined form, call them out clearly in the escalation section:

- Uncapped or unlimited liability.
- Intellectual property assignment or ownership transfer of client's pre-existing IP to the vendor.
- Terms on any "never accept" list the attorney has provided.
- Personal guaranty by the attorney or a principal of the client.
- Waiver of jury trial or class action rights.
- Residuals clause without a defined scope limit (in NDAs).

Use the **Contract Issue Escalation Flagger** skill to draft the escalation ask for any of these items.

---

## Governing law and jurisdiction

Default assumption is **North Carolina / United States** for all governing law analysis, standard-of-care benchmarks, and risk assessments. Surface this assumption at the top of every memo.

If the agreement specifies another jurisdiction, or if the counterparty is outside the United States:
- Flag the governing law explicitly.
- Note that North Carolina / US standards were applied as a baseline and that jurisdiction-specific analysis may differ.
- Recommend the attorney verify key terms (especially indemnification, limitation of liability, and data protection) against the applicable jurisdiction's law or engage counsel admitted there.

---

## Privilege note

Review memos and redline drafts are attorney-client privileged work product. Do not suggest distributing them outside the attorney-client relationship (e.g., to a business team distribution list that includes non-employees or non-counsel) unless the attorney instructs otherwise.

---

## What this skill does not do

- Does not approve, sign, or commit to any contract term on the firm's or client's behalf.
- Does not access Westlaw, CoCounsel, iManage, Ironclad, DocuSign, or any external legal research or contract management system — use web_search and documents the attorney provides.
- Does not know the firm's playbook positions unless the attorney supplies them.
- Does not send redlines or communications to the counterparty.
- Does not create or save documents — presents results in chat for the attorney to review and save in the app if they choose.
- Does not substitute for the attorney's independent legal judgment on any issue.
