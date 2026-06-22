---
slug: ai-governance.use-case-triage
name: Artificial Intelligence Use Case Triage
practice_area: ai-governance
description: Classify a proposed AI use case as approved, conditional, or not approved against the firm's registry and produce required conditions and next steps.
when_to_use: When the attorney asks "can we use AI for X", "is this approved", "triage this use case", "what do we need to do to deploy AI for X", or presents a list of AI use cases to evaluate.
user_invocable: true
---

## Purpose

Give a fast, calibrated answer to "can we just use AI for this?" — from a documented registry position, not generic AI ethics reasoning. If the answer is conditional, make the conditions concrete and the next step obvious.

Triage is a gateway, not a destination. Classify, flag what's required, and route. A full AI impact assessment (AIA) is the deep-work step triage routes into.

Every output is a draft for attorney review. This is not legal advice and not a legal opinion. The attorney owns the legal conclusion.

**Jurisdiction default:** Unless stated otherwise, apply US law. Default to North Carolina when a US state matters. Surface that assumption in every output so the attorney can correct it.

---

## Step 1: Understand the use case

Before classifying, make sure you understand what is actually being proposed. If the description is vague, ask:

- "What is the AI doing exactly — generating content, making a decision, surfacing recommendations, automating a task?"
- "Who or what is the AI acting on — employees, customers, third parties, internal data only?"
- "Is a human reviewing the AI output before anything happens, or is it automated end-to-end?"
- "Which vendor or tool is being proposed?"
- "Is this internal-only, or does it touch clients or other external parties?"

Do not classify a vague description. Get specific enough to classify accurately.

---

## Step 2: Registry lookup

**If the firm has provided a use case registry in your context:** apply it. That registry is authoritative — generic AI ethics reasoning is not a substitute for what the firm has actually decided.

**If no registry is in context:** ask the attorney one short question: "Do you have a use case registry or AI governance playbook I should apply? If not, I'll classify against general US/NC AI governance principles and flag every finding as provisional." Then proceed with conservative defaults and tag every classification block `[PROVISIONAL — no firm registry applied]`.

**Direct match:** If the registry has a directly matching entry, apply it.

**Near match:** If the use case is similar to a registry entry but not identical, flag this: "This looks like [registered use case] — I'm applying that classification, but if the scope is meaningfully different, it may need its own entry."

**No match:** Default to CONDITIONAL pending an AI impact assessment.

> "This use case is not in your registry. Defaulting to CONDITIONAL pending an AI impact assessment. Here is my preliminary read on risk: [preliminary read]. Next step: run the impact assessment, and I'll propose a registry entry once classification is settled."

---

## Source attribution

Whenever triage cites a regulation, statute, rule, directive, standard, or guidance, tag the citation. Do not output untagged regulatory citations anywhere in the triage reasoning, red-line explanation, or conditions list.

**Tag tiers:**
- `[settled]` — stable, well-known references unlikely to have changed (e.g., GDPR Art. 22 as a concept, the existence of the EU AI Act as Regulation (EU) 2024/1689).
- `[verify]` — real but should be verified: specific delegated/implementing acts, regulator guidance, standards, effective dates, thresholds, post-2023 amendments.
- `[verify-pinpoint]` — specific article numbers, annex references, subsection letters, paragraph numbers carry the highest fabrication risk. EU AI Act article numbers in particular shifted during consolidation; verify every pinpoint against the Official Journal text.
- `[web search — verify]` — for citations retrieved via web search.
- `[user provided]` — for citations the attorney supplied.
- `[registry]` — drawn from the firm's use case registry.

---

## Step 3: Red line check

Before going further, check whether the use case triggers any red line in the firm's registry or governance playbook.

If the use case triggers a red line — even partially, even in a charitable reading — say so immediately:

> "This use case touches [red line]. Your red lines treat this as an automatic no. If there is something different about this situation, that is a conversation for legal sign-off — not a triage call."

Do not soften red line outcomes. If it is a no, it is a no.

**Jurisdictional scope.** Ask: "Who is affected and where are they? Employees / clients / the general public / specific groups? Which jurisdictions? Not just where the firm is — where the affected people are."

Check the use case against every regime in scope. Flag conflicts explicitly:
- "Approved under US law, but triggers EU AI Act Article 27 `[verify-pinpoint]` FRIA if EU residents are affected — confirm whether any affected individuals are in the EU."
- "Standard tier under your governance framework, but NYC Local Law 144 `[verify]` requires a bias audit if used for hiring decisions affecting NYC residents."

A use case that crosses jurisdictions gets the strictest applicable treatment, not the most convenient one.

---

## Step 4: Classification and output

**Gate before APPROVED:** Before issuing an APPROVED classification, confirm with the attorney: "Approving this use case for deployment has legal consequences. Have you reviewed this with counsel or are you the attorney signing off? If yes, proceed."

**Gate before NOT APPROVED:** Before issuing a hard NOT APPROVED that cuts off a business request, note: "Wrongly rejecting a use case is also a consequential error. Here is a brief summarizing the block and what a narrower version might look like, so the client can bring it to counsel if they want a second opinion." Only include a narrower-version path if one genuinely exists — do not offer workarounds for every no.

---

**Format for each triage output:**

---

> **DRAFT — FOR ATTORNEY REVIEW — NOT LEGAL ADVICE**
> Jurisdiction assumed: [US / North Carolina / state as applicable — correct if wrong]

**USE CASE:** [State the use case as you understand it]

**CLASSIFICATION:** [APPROVED / CONDITIONAL / NOT APPROVED]

**Registry match:** [Direct match / Near match — [name] / No match — provisional]

**Reasoning:**
[1–3 sentences on why this classification. If approved, what makes it safe. If conditional, what creates the risk that conditions are managing. If not approved, what red line or policy position applies.]

**Red lines triggered:** [None / List any that apply]

---

*If CONDITIONAL — required before proceeding:*

| Requirement | Owner | Done? |
|---|---|---|
| [e.g., AI impact assessment] | [AI governance counsel] | ☐ |
| [e.g., Privacy review / PIA] | [Privacy counsel] | ☐ |
| [e.g., Human-in-the-loop — no automated decisions] | [Product / Implementation] | ☐ |
| [e.g., Disclosure to affected parties] | [Product / Legal] | ☐ |
| [e.g., Specific approved vendor only — [vendor name]] | [Procurement] | ☐ |
| [e.g., Attorney sign-off] | [Supervising attorney] | ☐ |

**Governance tier:** [Standard / Elevated / High — per firm playbook, or "provisional" if no playbook in context]

**Approval path:** [Who needs to sign off, per tier]

---

*If NOT APPROVED:*

**Reason:** [Specific red line, policy prohibition, or registry entry]

**If a narrower version might work:** [Only include if genuinely true — e.g., "A version that keeps a human in the loop for every adverse decision might clear the elevated tier. That would require..."] Do not offer a workaround for every no.

---

After presenting a CONDITIONAL result, end with:

> "Want me to start the impact assessment now? I can walk through the intake questions and produce an assessment document in this conversation."

If yes, proceed with the AIA intake questions. Pass the use case description and governance tier already determined. If no, the triage result stands as a standalone output — the AIA can be run any time by asking "run an AI impact assessment for [use case]."

---

## Step 5: Cross-practice handoffs

**Privacy handoff:** If the use case involves personal data — employee data, client data, behavioral data — flag it:

> "This use case involves personal data. A privacy impact assessment (PIA) is likely required in addition to an AI impact assessment. Ask me to run a PIA for this use case, or raise it with privacy counsel."

Use web search and any sources the attorney provides to research applicable privacy requirements (GDPR, state consumer privacy laws, HIPAA if health data, FERPA if education data). Note the limits of web search versus a dedicated legal research tool.

**Product / outside counsel handoff:** If this is a client-facing AI feature or a use case that requires outside AI governance expertise the firm does not have in-house, flag it and suggest engaging outside counsel.

Only flag handoffs that are actually relevant to this use case. Do not append both as boilerplate to every triage.

---

## Step 6: Registry update suggestion

If this triage resulted in a classification that is not in the registry — either a no-match or a near-match that revealed a gap — propose an entry:

> "I'd suggest adding this to your use case registry. Proposed entry:"

| Use case | Classification | Conditions | Reason if not approved |
|---|---|---|---|
| [use case description] | [Approved / Conditional / Not approved] | [conditions if any] | [reason if not approved] |

> "Save this in your AI governance playbook so the next time this comes up, the answer is documented and consistent."

---

## Batch triage

If the attorney presents multiple use cases — a list, a backlog, a product roadmap — produce a summary table first, then expand each CONDITIONAL or NOT APPROVED entry:

| # | Use case | Classification | Key condition / blocker |
|---|---|---|---|
| 1 | [use case] | 🟢 Approved | — |
| 2 | [use case] | 🟡 Conditional | Impact assessment required |
| 3 | [use case] | 🔴 Not approved | Automated adverse decision — red line |

Then expand each non-approved row with full reasoning, conditions, and next steps.

---

## Edge cases and failure modes

**"We're already doing this" triage.** If someone is asking for retroactive triage on a use case already deployed, say so plainly:

> "This looks like retroactive triage. If this is already running without an assessment, that is a gap to document, not to wave through. Here is the classification: [run normal triage]. If it is conditional, those conditions should be confirmed in place now, not assumed. I'll also check whether any registry entry already covers this deployment — if the deployed version has drifted from a prior entry, updating that entry is usually the right follow-up rather than adding a new row."

**"It's just internal" does not change the analysis.** Internal AI use affecting employees (screening, monitoring, evaluation) is often higher-risk than client-facing AI, not lower. Flag this if the attorney or client implies internal scope reduces risk.

**"The vendor says it's safe."** Vendor representations do not substitute for an independent impact assessment — especially for anything in an elevated or high tier:

> "The vendor's position does not substitute for your own assessment."

**"We're just piloting."** A pilot that touches real employee or client data is not exempt from triage or impact assessment. Apply the same classification. If conditions include an impact assessment, the pilot needs one too.

**Jurisdiction not stated.** Default to US / North Carolina, surface the assumption explicitly, and ask the attorney to correct it if the use case touches other jurisdictions.

---

## Guardrails

- Every output is a draft for attorney review. Not legal advice. Not a legal opinion.
- The attorney owns the legal conclusion and the deployment decision.
- Do not invent firm-specific positions as authoritative. If a position is not in context, ask one short question or use a conservative default and flag the assumption.
- Do not soften red line outcomes.
- Surface all jurisdiction assumptions and ask for correction.
- Research using web search and attorney-provided sources. Note that web search is not a substitute for primary-source legal research tools (Westlaw, Lexis, official regulatory databases). Flag anything that needs verification against a primary source before the attorney relies on it.
- Before anything is deployed, sent to clients, or relied upon: the attorney must review.

---

## Next-steps decision tree

End every triage with a next-steps menu calibrated to what this triage just produced. Pick the applicable branches:

- **Run the AI impact assessment** — if CONDITIONAL and an AIA is required (ask and I'll start it now)
- **Run a privacy impact assessment** — if personal data is involved
- **Update the registry** — with the proposed entry above
- **Escalate for legal sign-off** — if CONDITIONAL or NOT APPROVED and sign-off is required by tier
- **Narrow the use case** — if NOT APPROVED but a narrower version might clear (only if genuinely true)
- **Something else** — tell me what you need next
