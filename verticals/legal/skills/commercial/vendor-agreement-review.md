---
slug: commercial.vendor-agreement-review
name: Vendor Agreement Review
practice_area: commercial
description: Reviews an inbound vendor agreement term-by-term against the firm's playbook positions, flags deviations by severity, generates specific redline language, and routes to the right approver.
when_to_use: When the attorney shares a vendor Master Service Agreement, SaaS subscription agreement, professional services agreement, or similar inbound vendor contract for review, or asks to redline or evaluate vendor paper.
user_invocable: true
---

# Vendor Agreement Review

## Destination check

Before producing output, verify where it is going. If the attorney names a destination outside the privilege circle — a counterparty, a vendor, a shared channel, a non-lawyer — pause and ask. When the destination looks outside the circle, offer: (a) the privileged version for legal eyes only, (b) a sanitized version for the broader audience, or (c) both. Do not silently apply a privileged header and then help paste the output somewhere that header will not protect it.

This memo and the underlying agreement may be privileged, confidential, or both. Distribute only within the privilege circle; mark and store it where privileged materials live; strip the work-product header before any external delivery (e.g., counterparty redlines, stakeholder summaries).

---

## Purpose

Read a vendor agreement against the firm's stated playbook positions, find every term that deviates, and give the attorney a review memo they can act on in one pass. Every issue gets a severity, a plain-English business-impact explanation, specific ready-to-paste redline language, and an escalation call if one is needed.

The result is a **draft memo for attorney review — not legal advice and not a legal opinion.** The attorney owns every legal conclusion and every decision to send, sign, or rely on any output from this review.

Jurisdiction assumption: **North Carolina / US federal law** unless the contract or matter context specifies otherwise. Surface this assumption at the top of every memo and flag when the contract's governing law diverges.

---

## Playbook positions

The firm's standard positions, fallbacks, and deal-breakers are the source of truth for this review. Apply them in this priority order:

1. **Positions in the current matter or client context** — if the attorney has noted specific positions in the matter, apply those first.
2. **Firm-level positions provided in context** — settings or notes the attorney has shared in this conversation.
3. **If a position is not given:** apply a conservative default and explicitly flag it with `[DEFAULT — confirm with attorney]`. Do not invent firm-specific positions as authoritative. Ask one short question rather than guessing on any point that materially changes the risk classification.

**Which side?** Before applying any positions, determine which side Pacheco Law's client is on for this contract. Usually obvious: if the counterparty is a vendor/supplier providing goods or services, the client is purchasing-side. If the counterparty is a customer buying the client's product/service, the client is sales-side. If unclear (a reseller arrangement, a partnership, a revenue share), ask: "Which side is [client] on for this agreement — vendor or customer?" Note the side in the output so the attorney knows which frame was applied.

---

## Workflow

### Step 1: Orient

Read the whole agreement once, fast. Fill in this table:

| Question | Answer |
|---|---|
| Agreement type | MSA / SaaS subscription / Professional services / License / Other |
| Client's role | Customer / Vendor (flag if not the expected purchasing-side) |
| Counterparty | Name; BigCo (limited negotiating room) or smaller (more flexible)? |
| Dollar value | Annual / total contract value if stated |
| Term | Length and renewal mechanics |
| Is there a DPA? | Attached / referenced by URL / missing |
| Governing law | State/jurisdiction as written in the contract |

**Dollar-value handling.** If the agreement does not state a contract value (common when an MSA sets terms but an order form carries price), stop and ask before routing or applying dollar thresholds:

> The MSA itself does not state an annual contract value — the Order Form carries the price. Before I apply escalation thresholds, I need the approximate value. Options: (1) share the Order Form value; (2) tell me whether this is above or below a threshold you care about and I will route accordingly, flagging the assumption; or (3) route conservatively to the higher approver regardless.

Do not silently assume a value and then use that assumption to drive approval routing.

**DPA-by-reference handling.** If the agreement incorporates a DPA "available at [URL]" or similar by reference, note it explicitly in the Orient table and in the memo:

> This agreement incorporates a DPA by URL reference. The DPA carries the real data terms — subprocessor rights, breach-notification timing, data-return mechanics, audit rights. Without reading it, the data-protection analysis below is partial. If you can paste the DPA text into the chat, I can extend the review to cover it; otherwise I will flag the gap and note that the data-protection findings are incomplete.

A missing DPA and an unread DPA are different gaps — label them differently.

---

### Step 2: Deal-breaker check

Check any deal-breakers the attorney has noted (in matter context or in this conversation) first. If a deal-breaker is present, surface it at the top of the memo and stop the detailed review — there is no point reviewing indemnity caps if the agreement grants the vendor rights the firm will never accept.

```markdown
## ⛔ DEAL-BREAKER PRESENT

**Section [X.X]** contains [the deal-breaker term]. This is a hard no per the firm's stated positions. Recommend:

- [ ] Push back — propose: [specific alternative language]
- [ ] Walk — if the counterparty will not move, do not sign

The detailed review below is provided for completeness but is moot unless this is resolved first.
```

If no deal-breakers have been stated and you encounter a term that commonly functions as a deal-breaker (e.g., vendor rights to use client data for AI/ML training; unlimited indemnity for the vendor's own gross negligence; unilateral right to assign to a competitor), flag it prominently and ask the attorney whether it is a hard stop. `[DEFAULT — confirm with attorney]`

---

### Step 3: Term-by-term comparison

For each standard category below, find the corresponding contract section and compare it against the firm's stated positions (or the conservative default if no position is given).

**For each deviation, produce this block:**

```markdown
### [Section X.X]: [Issue name]

**Position:** [firm's standard position if stated; otherwise "conservative default — [what was assumed]" tagged `[DEFAULT — confirm with attorney]`]

**Contract says:**
> "[exact quote from the contract]"

**Gap:** Missing term | Weaker than standard | Weaker than fallback | Non-standard structure | Unacceptable

**Legal risk:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low
**Business friction:** 🔴 Blocks deals | 🟠 Slows deals | 🟡 Confuses operations | 🟢 Invisible

**Why it matters:** [one or two sentences in plain English — what goes wrong if this term stays as-is]

**Proposed redline:**
> "[specific replacement language — ready to paste into a markup]"

**If they will not move:** [the fallback if stated; otherwise "escalate to attorney for decision before responding" `[DEFAULT — confirm with attorney]`]
```

**Severity calibration:**

| Level | Means |
|---|---|
| 🔴 Critical | Do not sign without fixing. A term on the firm's never-accept list, or a functional deal-breaker. |
| 🟠 High | Strongly push; escalate if the counterparty will not move. Outside the stated fallback range. |
| 🟡 Medium | Push in the first round; accept if it is the last open item. Inside the fallback range but short of the standard position. |
| 🟢 Low | Note it, do not spend capital. A term the firm explicitly tolerates, or a purely stylistic deviation. |

Not everything is Critical. Calibrate honestly.

#### Standard categories to check

Cover at minimum: limitation of liability (see detailed procedure below); indemnification; IP ownership and licensing back; data protection and security obligations; confidentiality; term and termination rights; auto-renewal and notice; assignment and change-of-control; governing law and venue; dispute resolution; non-solicitation; audit rights; insurance requirements; force majeure.

#### Liability cap decision procedure

The cap amount is the least important part of the cap. Work through all four dimensions and state each one explicitly:

1. **Direct vs. indirect/consequential damages.** Does the cap apply to all liability, or only direct damages? An annual-fees cap on direct damages with uncapped consequential damages is a completely different risk profile than a true aggregate cap. State both treatments explicitly.

2. **The cap base — quote it verbatim.** "12-month cap" could mean: fees paid in the 12 months preceding the claim; fees payable in the current 12-month period; total fees ever paid; fees under the current order form. These can differ by an order of magnitude. If ambiguous, flag it: "Cap base is ambiguous — `[exact quote]` — could mean [X] or [Y]. Confirm before signing."

3. **Cap-carveout interaction.** Enumerate what sits above the cap (carveouts) and what sits below (what is actually capped). Assess whether the capped surface is meaningful: "The cap covers general contract breach. Data breach, IP indemnity, and confidentiality are carved out and uncapped. For this vendor's risk profile, the capped surface is [meaningful / nominal]."

4. **Firm's position per dimension.** Apply any stated positions on direct cap, indirect/consequential damages exclusion, acceptable carveouts, and cap-base definition. If no position is given, apply conservative defaults and tag them. `[DEFAULT — confirm with attorney]`

#### Jurisdiction delta check

The contract's governing law may affect enforceability of positions the firm considers standard. Check the contract's actual governing law and flag the most common divergences:

- **Non-solicits / non-competes:** Unenforceable in California (Bus. & Prof. Code §16600); restricted in many other jurisdictions. In North Carolina, enforceable with reasonable time, geography, and scope limitations. `[jurisdiction — verify]`
- **Auto-renewal:** Several states (CA, NY, IL, and others) have specific notice-period requirements for auto-renewal clauses in B2B contracts. Verify for the contract's governing law. `[jurisdiction — verify]`
- **Liability exclusions:** Some states limit exclusion of gross negligence or willful misconduct even in B2B contracts. `[jurisdiction — verify]`
- **Indemnification:** Some states void indemnification for the indemnitee's own negligence. `[jurisdiction — verify]`
- **Perpetual confidentiality:** Some jurisdictions limit "perpetual" confidentiality obligations to a reasonable period. `[jurisdiction — verify]`

When the firm's preferred position conflicts with the contract's governing-law enforceability, flag: "The firm's standard position is [X], but this contract is governed by [Y] law where [X] may be [unenforceable / restricted / subject to statutory override]. `[jurisdiction — verify]`"

For jurisdiction-specific research, use web_search and flag citations as `[web search — verify]` or `[model knowledge — verify]`. Do not rely on recalled legal rules without flagging that they require attorney verification against a primary source. If search results are thin for a specific rule or jurisdiction, report what was found and ask the attorney whether to broaden the search, accept lower-confidence sources, or flag the gap and stop.

---

### Step 4: Favorable terms and gaps

Two short lists:

**Better than standard:** Terms where the vendor gave more than the firm would ask for. Note these — they are trade bait if something needs to be given up elsewhere in negotiations.

**Missing entirely:** Standard provisions not present at all. Most common: assignment restrictions, audit rights, force majeure, insurance requirements, specific data-breach notification timelines.

---

### Step 5: Escalation routing

Using any escalation thresholds or approver rules the attorney has provided, state clearly who needs to approve:

```markdown
## Approval routing

Based on [dollar value / issue severity], this agreement requires:

- [ ] **[Name/role]** approval — [reason]
- [ ] **[Business owner / client]** sign-off on [specific commercial term they should weigh in on]

**Recommended next step:** [Send redlines to counterparty | Escalate before responding | Get client input on commercial term X before legal responds]
```

If no escalation matrix has been provided, apply a conservative default: flag any 🔴 Critical issue as requiring attorney review before any response goes to the counterparty, and note the assumption. `[DEFAULT — confirm with attorney]`

**Before sending redlines to the counterparty:** Confirm with the attorney that the redline package is ready to go. Do not treat "the review is done" as authorization to send. Sending redlines is a legal act — the counterparty will treat every edit as the negotiating position.

**Before generating a signature envelope or routing for countersignature:** This step has legal consequences. Confirm with the attorney. Do not proceed without explicit instruction.

---

### Step 6: Redline granularity

Edit at the smallest possible granularity. A redline is a negotiation artifact, not a rewrite. Surgical redlines signal "we have specific asks" and are faster to read, understand, and accept than wholesale replacements.

Default to the smallest edit that achieves the position:
- Replace a **word** before a phrase.
- Replace a **phrase** before a sentence.
- Restructure a **subclause** before replacing the sentence.
- Replace a **sentence** before replacing the clause.
- Only replace a **whole clause** when the counterparty's version is so far from the position that surgical edits would be harder to read — and when you do, say so: "We replaced §X.X rather than marking it up because the changes were extensive."

---

### Step 7: Assemble the memo

Present the result in chat for the attorney to review and save in the app if they choose. If a matter or client is in context, reference it; otherwise ask which matter this belongs to.

```markdown
[ATTORNEY WORK PRODUCT — PRIVILEGED AND CONFIDENTIAL]
[Draft for attorney review only — not legal advice and not a legal opinion]
[Jurisdiction assumption: North Carolina / US federal law unless noted otherwise]

# Vendor Agreement Review: [Counterparty] — [Agreement Type]

**Reviewed:** [date]
**Contract value:** [amount / term, or "see Order Form"]
**Client's role:** Customer / Vendor
**Governing law (as written):** [state/jurisdiction from contract]

---

## Bottom line

[Two sentences. Can the client sign this? What must change first?]

**Issues (legal risk):** [N]🔴 [N]🟠 [N]🟡 [N]🟢
**Issues (business friction):** [N]🔴 [N]🟠 [N]🟡 [N]🟢
**Approval needed from:** [name/role, or "see routing below"]

---

## Deal-breaker check

[✅ Clear | ⛔ Present — see above]

---

## Issues by severity

[All deviation blocks from Step 3, grouped Critical → Low]

---

## Favorable terms

[List]

## Missing provisions

[List]

---

## Approval routing

[From Step 5]

---

## Redline package

[If requested: consolidated markup-ready language for all proposed changes]
```

---

## Quality checks before delivering

- [ ] Governing law in the contract is noted and compared to North Carolina defaults
- [ ] Deal-breaker check was first
- [ ] Every issue has specific replacement language, not just "consider revising"
- [ ] Risk levels are calibrated — not everything is Critical
- [ ] Approver is named or a conservative default is flagged
- [ ] Counterparty context considered (BigCo vs. smaller counterparty affects what is worth fighting over)
- [ ] Every default assumption is tagged `[DEFAULT — confirm with attorney]`
- [ ] Every citation from web search is tagged `[web search — verify]`; every citation from model knowledge is tagged `[model knowledge — verify]`
- [ ] The memo is clearly labeled as a draft for attorney review, not as legal advice or a legal opinion

---

## Close with the next-steps decision tree

End every memo with a short next-steps decision tree. Customize the options to what this review produced. Default branches:

1. **Send redlines** — if issues are resolved or low-severity, the attorney may want to mark up and return.
2. **Escalate first** — if there are 🔴 Critical issues, confirm approval before responding.
3. **Get more facts** — if dollar value, counterparty identity, or a specific term is unclear, gather before proceeding.
4. **Ask the counterparty to re-draft** — if the agreement is so far from standard positions that marking it up is inefficient.
5. **Something else** — open to the attorney's direction.

The attorney picks the branch. The assistant supports whichever direction is chosen.
