---
slug: litigation.demand-received
name: Demand Letter Received — Triage and Response Options
practice_area: litigation
description: Triage an inbound demand letter — extract key fields, assess merit, identify response options with a recommendation, and surface immediate action items for the attorney.
when_to_use: When the attorney shares or describes an inbound demand letter and wants triage, a merit read, response options, or help deciding next steps.
user_invocable: true
---

## Purpose

Inbound demand letters vary enormously — some require urgent escalation, most can be answered with a holding letter or a structured response. The failure mode is treating them all alike. This skill extracts what matters, assesses merit, and lays out the decision the attorney needs to make.

Every output is a draft for attorney review. Nothing here is legal advice or a legal opinion. The attorney owns every legal conclusion.

---

## Step 1: Obtain the demand

If the attorney has not already provided the demand letter, ask for it now — paste, upload, or describe its contents. If a matter or client is already in context, note it and use it to ground the triage.

---

## Step 2: Extract key fields

Read the demand and pull:

- **Sender** — entity name, signer, and whether it is signed by outside counsel
- **Recipient** — which entity or person at the firm or client
- **Delivery method** — certified mail, email, courier, hand-delivery (matters for deadline calculation)
- **Date received** vs. **date signed/dated**
- **Demand type** — payment, breach/cure, cease-and-desist, preservation, settlement, or other
- **Specific asks** — exactly what they are demanding and by when
- **Facts alleged** — their version of what happened
- **Legal basis** — statutes, contract provisions, or legal theories they cite
- **Threats** — what they say they will do if not satisfied
- **Settlement-communication framing** — note whether the demand is labeled as a settlement communication (e.g., "pursuant to Rule 408" or "for settlement purposes only"). Remember: protection under FRE 408 (federal) or the applicable state equivalent (North Carolina: N.C.G.S. § 8C-1, Rule 408, absent a more specific provision) attaches from the conduct and context of the communication, not merely from a label. Capture both the label (if any) and a first-pass read of whether the substance is in fact a compromise discussion. Flag `[SME VERIFY: settlement-communication protection under applicable forum rule]`.

---

## Step 3: Matter cross-check

Using whatever matter and client context is available:

- Is this counterparty already a party in an active or recently closed matter?
- Does the subject (same contract, project, product, or transaction) overlap with an existing matter?
- Has this counterparty sent prior demands?

Present the finding:

- **Existing active matter** — recommend adding this demand to that matter rather than opening a new one.
- **Closed matter, same counterparty** — flag: the counterparty is back. May be a new dispute or a resurrection. Attorney decides whether to open a new matter or reopen the old one.
- **Subject overlap** — note as context and precedent, likely a distinct matter.
- **No match** — treat as fresh.

If there is no matter context available, ask the attorney which matter this belongs to, or whether to treat it as a new intake.

---

## Step 4: Merit assessment

This is a structured read for triage routing — not a legal opinion or a merit determination. Label it as such.

- **Facts** — do the alleged facts align with what the attorney knows? Where is the disconnect?
- **Legal basis** — are the cited provisions, statutes, or theories facially applicable? Flag each citation as `[SME VERIFY: applicability / currency / jurisdiction]`. Do not validate law autonomously.
- **Their case if litigated** — one paragraph: what is their story if they filed tomorrow?
- **Likely defenses** — one paragraph: what are the firm's or client's most credible defenses?
- **Damages proportionality** — is their demand proportionate to what a court would likely award if they prevailed?
- **Credibility of threat** — does it appear they are positioned and motivated to file? Are they represented by experienced litigation counsel?

Assign a **triage rating**: `substantial merit` / `debatable` / `weak` / `frivolous`. Be direct — the attorney is triaging, not reading a brief. Tag: `[SME VERIFY: counsel to confirm before relying on this rating]`.

**Research limits.** If the demand cites authorities you cannot confidently evaluate:
- Use web_search to check basic applicability and currency, and tag every result `[web search — verify]`.
- Do not present web-search results as settled law.
- If coverage is thin or confidence is low, say so explicitly: "The demand cites [authority]. Web search returned limited results. Recommend verifying against a primary source or with outside counsel before relying on this in a response."

**Source tagging.** Tag every citation you carry into the triage:
- `[user provided]` — citations from the demand itself
- `[web search — verify]` — citations located via web_search
- `[model knowledge — verify]` — citations recalled from training; higher fabrication risk, check first

---

## Step 5: Response options

Present three or four options with tradeoffs. Recommend one.

**Option A — Substantive response**
- When: the demand has merit or is at least debatable; a reasoned reply protects the record and may resolve the dispute.
- Tradeoff: commits the firm/client to a position in writing; must be accurate and measured.
- Next step: attorney drafts or directs the assistant to draft a response letter for review.

**Option B — Holding letter**
- When: more time is needed to investigate; the firm does not want to trigger the sender's deadline math or concede anything prematurely.
- Tradeoff: buys 2–4 weeks but does not resolve the dispute; sender may proceed anyway.
- Next step: assistant can draft a short acknowledgment holding letter for attorney review.

**Option C — Settlement response**
- When: early resolution is cheaper than litigation and the attorney is willing to discuss without admitting liability.
- Tradeoff: the response must be structured so the substance — not just the label — qualifies as a compromise discussion under the applicable settlement-communication rule. Must be careful not to waive claims or create admissions outside that protection. `[SME VERIFY: applicable forum rule before sending]`.
- Next step: attorney directs the assistant to draft a settlement-posture response for review.

**Option D — Ignore and preserve**
- When: the demand is frivolous or legally inert and the stated deadline creates no legal prejudice.
- Tradeoff: silence can be adverse in some contexts (e.g., account stated under North Carolina law); a legal hold is still required regardless.
- Next step: attorney issues a litigation hold; demand is logged; no substantive response sent.

State your recommendation and the two-sentence reason. Tag: `[SME VERIFY: counsel to confirm before executing]`.

---

## Step 6: Deadline triage

- **Their stated deadline** — note it; it does not bind the firm unless it corresponds to a legal or contractual deadline.
- **Internal decision deadline** — when the attorney must decide (typically: stated deadline minus several business days to draft and approve).
- **Legal deadlines** — statute of limitations, contractual cure periods (flag the contract provision), notice requirements, or procedural deadlines if litigation is already pending.

Flag any legal deadline that is tight. Recommend the attorney calendar it.

**Assumption:** Unless otherwise stated, apply North Carolina law and US federal law as defaults. Surface this assumption explicitly and ask the attorney to confirm or correct the forum.

---

## Step 7: Immediate action checklist

Present as a checklist for the attorney to work through:

- [ ] Legal hold issued — if litigation is reasonably anticipated, a litigation hold on potentially relevant documents is required now, regardless of response strategy
- [ ] Matter opened or linked in the app
- [ ] Counsel assigned (or outside counsel to be retained)
- [ ] Insurance notified / claim tendered if applicable
- [ ] Internal escalation (client business lead, GC, or equivalent) — who and by when
- [ ] Response decision made and response deadline calendared

---

## Step 8: Triage summary (present in chat)

Present the triage result in chat for the attorney to review and save in the app if they choose. Use the following structure:

```
PRIVILEGE NOTICE: This triage derives from the inbound demand and records attorney first-pass analysis. The internal merit read and response posture are attorney-client and/or work-product material. Do not forward beyond the privilege circle (e.g., to the client's business team unmarked, to the counterparty, or to an insurer) without deliberate review. Store with privileged matter material.

READ FOR TRIAGE — NOT A LEGAL OPINION. The triage rating below is a structured read to support routing decisions. It is not a merit opinion and does not substitute for case-specific legal analysis. All citations flagged [SME VERIFY] must be independently checked before relying on them.

---
DEMAND TRIAGE

Received: [YYYY-MM-DD]
Received by: [entity / person]
Matter: [matter name / new intake]

THE DEMAND
Sender: [entity, signer, counsel]
Type: [demand type]
Asks: [list]
Their stated deadline: [date]
Settlement-communication framing: [labeled / substantive / neither / ambiguous] — [SME VERIFY: forum rule]

FACTS ALLEGED
[one paragraph — their version]

LEGAL BASIS CITED
[list of citations, each tagged [user provided] + [SME VERIFY: applicability / currency / jurisdiction]]

THREATS / NEXT STEPS STATED
[list]

---
MATTER CROSS-CHECK
[finding: new / existing / overlap]
Recommendation: [open new / add to existing / link / standalone]

---
MERIT ASSESSMENT
Facts: [alignment / disconnects]
Legal basis: [applicability read, with flags]
Their case if litigated: [one paragraph]
Likely defenses: [one paragraph]
Damages proportionality: [assessment]
Credibility of threat: [assessment]

Triage rating: [substantial / debatable / weak / frivolous]
[SME VERIFY: counsel to confirm before relying]

---
RESPONSE OPTIONS
A. Substantive response — [rationale, tradeoffs]
B. Holding letter — [rationale, tradeoffs]
C. Settlement response — [rationale, tradeoffs]
D. Ignore + preserve — [rationale, tradeoffs]

Recommendation: [A / B / C / D] — [two-sentence reason]
[SME VERIFY: counsel to confirm before executing]

---
DEADLINES
Their stated deadline: [date]
Internal decision deadline: [date]
Legal deadlines: [SoL, cure periods, procedural — with dates and flags]

---
IMMEDIATE ACTIONS
[ ] Legal hold issued
[ ] Matter opened or linked
[ ] Counsel assigned
[ ] Insurance notified / claim tendered
[ ] Internal escalation
[ ] Response decision and deadline calendared
```

---

## Step 9: Next-steps decision tree

Close by presenting the attorney with a clear decision:

> **What would you like to do next?**
> 1. Draft a response letter (substantive, holding, or settlement-posture) for your review
> 2. Open a new matter in the app for this demand
> 3. Link this demand to an existing matter
> 4. Issue a litigation hold
> 5. Something else — tell me what you need

The attorney picks. The assistant does not proceed without direction.

---

## What this skill does not do

- **Validate cited law.** Citations are flagged for the attorney to verify via a legal research tool or outside counsel. Do not rely on any citation in this triage without independent verification.
- **Send any response.** All drafts are for attorney review only. Nothing goes out without the attorney's deliberate decision.
- **Decide merit definitively.** The triage rating is a routing tool. A formal merit opinion belongs with the attorney or outside counsel after thorough analysis.
- **Make the matter-creation call.** The skill surfaces the recommendation; the attorney decides.
- **Access Westlaw, CourtListener, or other legal research databases.** This assistant uses web_search for publicly available material and tags all results accordingly. Attorney should verify any cited authority against a primary source.
