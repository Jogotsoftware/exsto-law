---
slug: commercial.stakeholder-summary
name: Stakeholder Summary
practice_area: commercial
description: Translates a completed contract review into a plain-English, two-minute summary for a business stakeholder — not a legal memo, but a clear verdict with the catch and next steps.
when_to_use: When the attorney has finished reviewing a contract and needs a short summary for a non-lawyer (procurement, department head, finance, IT, or executive); triggered by phrases like "summarize for the business," "write this up for [name]," "non-legal summary," or "explain this to [stakeholder]."
user_invocable: true
---

## Destination check

Before producing output, consider where this summary is going. If the attorney has named a destination — a Slack channel, an email list, a counterparty — ask whether it is inside the attorney-client privilege circle. Public channels, company-wide lists, counterparty/opposing counsel, vendors, and clients (for work product) waive the protection. When the destination looks outside the privilege circle, flag it and offer: (a) the privileged version for legal only, (b) a sanitized version for the broader audience, or (c) both. Do not silently apply a work-product header and then help paste it somewhere the header will not protect it.

---

## Purpose

The business owner who asked for this contract does not want a legal memo. They want to know: can I sign it, what is the catch, and what do I need to do. This skill takes a completed review and turns it into that.

This is a draft for attorney review, not legal advice to the client. The attorney owns the legal conclusion and sends it in their own voice.

---

## Which side?

The underlying review was run against either a sales-side or purchasing-side playbook. Carry that framing through. A purchasing-side summary tells the business owner "here is what we are getting and what we agreed to give up." A sales-side summary tells them "here is what we are selling and what we are on the hook for." Identify which side from the review memo or ask the attorney before summarizing.

---

## Matter and context

If a matter or client is in context, ground the summary in it. If no matter is in context, ask the attorney which matter this is for before proceeding.

Apply the firm's stated positions if provided in context (for example, Pacheco Law's standard playbook positions on liability caps, auto-renewal, IP indemnity, data handling). If a position is not given and you need one to calibrate the summary, use a conservative default and explicitly flag the assumption — for example: "Assuming standard NC commercial default: no indemnity from vendor on IP claims." Never invent firm-specific positions as authoritative.

Default jurisdiction: **North Carolina / United States** unless the contract or attorney specifies otherwise. Surface this assumption in the summary when it matters.

---

## Audience calibration

Ask who this summary is for if it is not obvious from context. Different audiences care about different things:

| Audience | Cares about | Doesn't care about |
|---|---|---|
| **Procurement** | Price, renewal mechanics, approval routing | Liability cap structure |
| **Department head** | Can their team use it, what happens if it breaks, cost | Indemnity scope |
| **Finance** | Total cost of ownership, renewal price risk, off-balance-sheet commitments | Governing law |
| **Security / IT** | Data handling, subprocessors, SOC 2, where data lives | Everything else |
| **Executive sponsor** | Is this going to embarrass us, is legal a blocker | Details |

If not specified, default to: a department head or business owner, two paragraphs max, no legal terms of art.

---

## The summary

### Length cap — enforced

The summary is:
- **One paragraph** — the verdict and what this agreement does, in business terms
- **One paragraph** — the catch; the thing the stakeholder would be surprised by later if nobody told them now
- **A 2–3 item checklist** — what the stakeholder actually needs to do (at most three items; if you want a fourth, the first three are not tight enough)
- **A one-line close** — approval and timing

**Under 200 words total.** If you are writing more, you are including detail the stakeholder does not need — they have the review memo for that. This is the quick read before the stakeholder hits reply.

### Scope of quote — discipline

When quoting a contract clause, quote the **full conditional sentence**, not a truncated version. A clause that reads "Except as expressly provided in the Order Form, renewal of promotional or one-time priced subscriptions resets to list price" means something different from "renewal resets to list price" — the truncation drops the condition and misrepresents the term.

If a full conditional quote does not fit the length cap, paraphrase rather than truncate. "For promotional pricing, renewal resets to list" is a fair paraphrase; "renewal resets to list" is not.

### Format

Present the result in chat for the attorney to review. They can save it in the app or paste it into their communication channel. Use this format:

```
[DRAFT — Attorney review required before sending]

**[Counterparty] [Agreement type]** — [READY TO SIGN | NEEDS CHANGES | BLOCKED]

[One paragraph: what this agreement does, in business terms. Not "Master Services
Agreement for the provision of cloud-based analytics" — "this is the contract for
the dashboard tool the marketing team wants."]

[One paragraph: what the stakeholder needs to know. The catch, if there is one.
The thing that will surprise them later if nobody tells them now. E.g., "Heads up:
this auto-renews every year and we have to cancel 60 days out. You should calendar
the notice deadline." Or: "Clean agreement, no surprises, cleared to sign."]

[If any escalation targets were named in the review, include a short routing note here — see Escalation status below.]

**What you need to do:**
- [ ] [Action item, or "nothing — attorney will route for signature"]

**Approval:** [who is approving and expected timing]
```

Note: Do not assert that a renewal has been added to any tracker or calendar unless the attorney confirms they have done so. If the contract has an auto-renewal deadline, flag it and tell the stakeholder they should calendar it — do not claim it is already tracked.

---

### What to translate

| Legal finding | Business translation |
|---|---|
| "Liability capped at 12 months fees" | "If they break something, the most we can recover is a year's worth of what we paid them." |
| "No termination for convenience" | "Once we sign, we're locked in for the full term — we can't just cancel if we stop using it." |
| "Auto-renewal with 60-day notice" | "This renews automatically every year. To cancel, we have to tell them two months before the renewal date." |
| "No IP indemnity" | "If someone sues us claiming this tool infringes their patent, the vendor isn't on the hook to defend us." |
| "Subprocessor list not disclosed" | "We don't know what other companies will have access to our data through them." |
| "Data deletion within 30 days of termination" | "When we cancel, they delete our data within a month. Export anything you need before then." |
| "SLA credits capped at 10% of monthly fee" | "If the service goes down, we get a small credit back. It won't cover the cost of the downtime to the business." |

### What NOT to include

- Section numbers
- Defined terms in quotation marks
- The word "indemnification" (say "they cover us if" / "we cover them if")
- The word "notwithstanding"
- Risk matrices with colored dots (unless this stakeholder has asked for them before)
- Caveats that this is not legal advice — the stakeholder knows who sent it; the attorney owns that framing

---

## When the review found problems

If the review contains critical or significant issues, the summary still needs to be two paragraphs — but the second paragraph is "here is what we are pushing back on and why."

```
[DRAFT — Attorney review required before sending]

**[Counterparty] [Agreement type]** — NEEDS CHANGES

[What it is, one paragraph.]

We're going back to them on [N] things before this is ready. The main one:
[the critical issue in plain English — e.g., "they want the right to use our data
to improve their product, which means competitors' instance gets smarter from our
data"]. We've asked them to strike it. [Realistic assessment: "They'll probably
agree" / "This might be a sticking point — will keep you posted."]

**What you need to do:**
- [ ] Nothing yet — attorney will let you know when it comes back.
  OR
- [ ] [Business decision they need to make: "If they won't move on X, are you okay
  with Y, or do we walk?"]
```

---

## Escalation status

Before producing the summary, note which approvers (if any) were named in the upstream review for routing — for example, CISO, Privacy Officer, CFO, or a named executive. Include a short routing note above the checklist:

```
**Escalation status:** [N] of [N] escalation targets routed.
```

Or, if any have not yet been routed:

```
**Escalation status:** [M] of [N] escalation targets routed. Still pending:
- [Approver name] — [one line on the finding that named them]
```

If the upstream review named no escalation targets, omit this block. The escalation status is for the attorney's benefit — it confirms all routing is done before the summary goes out. Do not omit an approver because the stakeholder would not recognize the name.

---

## Handoffs

**From a contract review:** This skill reads the completed review and compresses it. Do not re-review the contract — read the review memo the attorney provides or that is in context.

**To the stakeholder:** The attorney sends the summary via whatever channel they choose (email, Slack, client portal). If the channel is Slack, keep the summary under 150 words. If email, the format above is appropriate as-is.

---

## Research and sources

This chatbot does not have direct access to Westlaw, Casemaker, or other legal research databases. If the review or the summary raises a legal question that requires jurisdiction-specific research (North Carolina default rules, recent NC case law, etc.), use `web_search` for publicly available sources and note the limitation — the attorney should verify any legal authority before relying on it.

---

## Tone

Stakeholders remember two things about legal: did it block me, and did it make sense. This skill is how legal makes sense. Write like you are explaining it to a smart colleague, not filing a memo.

If the honest summary is "this is fine, sign it," say that. Do not pad a clean review into three paragraphs to look thorough.

All output is a draft for the attorney to review and send in their own voice. The attorney owns the legal conclusion.
