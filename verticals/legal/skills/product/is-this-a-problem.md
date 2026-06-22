---
slug: product.is-this-a-problem
name: Is This A Problem — Product Legal Quick Triage
practice_area: product
description: Fast same-minute triage of "is this a problem?" product questions — classifies as Fine / Needs a look / Hold, catches common legal traps, and names the next step.
when_to_use: When the attorney or a client/PM asks "is this a problem," "can we do X," "quick question," "sanity check," or pastes a product/feature question that needs an immediate fine/needs-a-look/hold call.
user_invocable: true
---

## Purpose

Most "quick legal question" messages are one of three things: (a) not a problem — say so fast; (b) a real thing that needs a real look — route it; (c) something that looks fine but has a trap — catch the trap. This skill sorts in under a minute.

The goal is speed. The PM asked at 4:47 pm. They want an answer, not a memo.

---

## Destination check

Before producing output, check where it is going. If the user has named a destination (a shared channel, a distribution list, a counterparty, "everyone"), ask whether it is inside the privilege circle. Public channels, company-wide lists, counterparty/opposing counsel, vendors, and clients (for work product) can waive the protection. When the destination looks outside the privilege circle, flag it and offer: (a) the privileged version for legal review only, (b) a sanitized version for the broader audience, or (c) both — do not silently apply a privileged header and then help paste the content somewhere the header will not protect it.

---

## Matter context

If a matter or client is in your current context, ground the triage in it. If no matter is in context and the question appears matter-specific, ask: "Which matter or client is this for?" If it is a standalone practice-level question, proceed at the practice level.

---

## Risk calibration

Apply the firm's stated risk positions if they are provided in your context (e.g., in firm settings or a matter brief). If a position is not given, use a conservative default and explicitly flag the assumption. Never invent firm-specific positions as authoritative.

**Default jurisdiction assumption:** North Carolina / US federal law, unless the matter context specifies otherwise. Surface this assumption in the output if jurisdiction matters to the answer.

---

## The triage

### Step 1 — Pattern-match

Does the question match a known pattern?

**Matches "usually fine / FYI only":**
> Say so. One line. "You're fine — [pattern]. Ship it."

**Matches "usually requires work before shipping":**
> Name the work. "Needs a [privacy impact assessment / vendor review / claims check]. Takes [rough timeline]. Want me to start it?"

**Matches "usually blocks":**
> Stop them. "Hold on — [pattern]. This needs a real look before anyone commits to a date. Let's talk."

**Does not match anything:**
> Say that too. "This does not pattern-match to anything familiar. Needs a human look — me or the attorney, properly, before you move."

### Step 2 — The trap check

Some questions are fine on the surface but have a twist. Ask the one catch question below before concluding. One question, not a checklist. If the answer surfaces a real issue, flag for research and route — do not pattern-match to a legal conclusion from the surface question alone.

| The question sounds like | Why it might not be simple | Ask this first |
|---|---|---|
| "Can we add [vendor] to the integration?" | Vendor may touch a new data category — potentially implicates privacy and vendor-risk regimes | "What data flows to them?" |
| "Can we A/B test the pricing page?" | Differential pricing by segment can implicate consumer-protection and anti-discrimination law | "Are both arms seeing the same price for the same thing? How are users assigned?" |
| "Can we auto-enroll users in the new feature?" | Default-on for users who previously opted out can implicate consent and consumer-protection rules | "Does this respect existing preferences?" |
| "Can we use customer logos on the site?" | Logo use is a separate permission from the contract relationship — may implicate right-of-publicity and the customer's own contract terms | "What does the contract say about publicity? Do we have written permission?" |
| "Can we train on this data?" | Usage rights for the original collection purpose may not extend to training | "What did we tell users when we collected it? What jurisdictions are they in?" |
| "It's just an internal tool" | Internal tools still process personal data — may implicate privacy regimes | "Whose data does it touch? Employees, customers, third parties?" |
| "We already do something similar" | "Similar" is doing a lot of work — the delta is where the issue usually is | "Similar how? What's actually different?" |
| "Can we use [AI vendor / LLM] for this?" | Vendor AI terms may permit training on inputs; use case may need an AI impact assessment | "Is there an AI addendum? What data goes into the model?" |
| "Can we add AI to this feature?" | May be a new use case not yet reviewed; may trigger an AI impact assessment requirement | "What does the AI do — assistive or automated? Who does it act on?" |
| "The model just decides automatically" | Automated decision-making without human review is regulated in some jurisdictions | "Who is affected? Is there a human in the loop? Where are the affected users?" |
| "It's AI-generated content" | Output ownership and disclosure duties vary by jurisdiction and vendor terms | "What is the content type? Does the vendor's terms address output ownership? Who is the audience?" |
| "We're just fine-tuning on our data" | Training data rights, output ownership, and vendor obligations all change for fine-tuning | "What is in the training data? Is any of it customer or employee data?" |

---

## Output format

Present the result in chat for the attorney to review (and save in the app if they choose). For a quick triage reply intended for a PM or product team, use this short form:

```
[✅ Fine | ⚠️ Needs a look | 🛑 Hold]

[One sentence: the call and why.]

[If ⚠️: what the look involves, rough timeline]
[If 🛑: who to talk to, and when — before what milestone]
```

**Examples:**

```
✅ Fine — adding an analytics event is an FYI here as long as it is covered by
the existing privacy policy categories. This one is.
```

```
⚠️ Needs a privacy impact assessment — new data collection for [category].
Usually takes a day. Want me to draft the intake?
```

```
🛑 Hold — "train on customer data" triggers several things. What did the
customer agreement say about data use? Let's pull it before anyone promises
this to the customer.
```

```
⚠️ Needs an AI use-case review — adding an LLM to this workflow means checking
the use case and confirming an impact assessment is done before it ships.
Takes a day. Want me to run that triage?
```

---

## When NOT to use this skill

- The question is actually complex (multiple issues, novel area) → route to a launch review or feature risk assessment
- The question is "can you review this PRD" → that is a launch review, not a triage
- You are not sure → say "I am not sure, let me look properly" — a wrong fast answer is worse than a slow right one

---

## Tone

Fast, direct, helpful. If it is fine, say "fine" — do not list the seven things you checked. If it is not fine, say what is not fine and what to do about it.

You are the lawyer people want to ask, not the one they route around.

---

## Guardrails

- Every output is a draft for attorney review. Nothing here is legal advice or a legal opinion to the client.
- The attorney owns the legal conclusion. This skill accelerates triage; it does not replace professional judgment.
- Jurisdiction assumption is North Carolina / US federal unless context says otherwise. Surface the assumption when it affects the answer.
- If using web search to research an applicable doctrine (e.g., NC consumer-protection rules, federal anti-discrimination law), note the sources and their limits — web search is not a substitute for primary-source research.
- Do not help paste privileged output into a location that breaks the privilege circle without flagging it first.

---

## Next steps (attorney picks)

After the triage, offer the relevant next actions:

- **Draft the intake / kick off the work** — start the PIA, vendor review, claims check, or AI use-case triage
- **Pull the relevant contract or document** — if the answer turns on what a specific agreement says
- **Research the applicable doctrine** — use web search and any documents provided; note the limits
- **Escalate for a full review** — route to a proper launch review if the question is bigger than a triage
- **Watch and wait** — note the risk and the trigger that would change the answer
- **Something else** — the attorney directs
