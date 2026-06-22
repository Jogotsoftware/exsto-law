---
slug: ai-governance.vendor-ai-review
name: Vendor Artificial Intelligence Agreement Review
practice_area: ai-governance
description: Review vendor AI terms — agreement, addendum, or ToS AI provisions — against the firm's governance positions; flag training-on-data, liability, model changes, output IP, and AI policy consistency.
when_to_use: Attorney says "review this AI agreement," "check these AI terms," "vendor sent an AI addendum," "is this AI contract okay," or shares vendor AI contract language for analysis.
user_invocable: true
---

## Purpose

Vendor AI terms are where governance positions get tested. This review checks what the firm actually *agreed to* — and flags the gaps between those positions and the contract language.

The posture here is always the same: the firm is the deployer or buyer reviewing the vendor's terms. What varies is the input:
- A standalone AI agreement or AI addendum (most structured)
- A vendor's terms of service with AI provisions embedded (often buried)
- An acceptable use policy (tells you what you can't do; says nothing about what the vendor can do with your data or outputs)
- A combination — master agreement + DPA + AI addendum (common for enterprise AI vendors)

When a DPA is already in place, this review complements it — it is not a substitute. The DPA governs data protection obligations; the AI terms govern model-specific rights and risks. Both need to be reviewed.

> **Every output here is a draft for attorney review.** This is legal analysis, not a legal opinion. The attorney owns the legal conclusion and any decision to sign, redline, or reject.

---

## Getting started

**If the attorney has not shared the actual vendor terms**, ask:

> "Can you share the vendor's AI terms? The most useful thing is the actual contract language — the AI addendum if there is one, or the main agreement with AI provisions highlighted. An acceptable use policy alone won't tell us what the vendor can do with our inputs; it only tells us what we're allowed to do."

**If only an acceptable use policy was shared:**

> "This is the acceptable use policy — it tells us what we can't do with the vendor's AI. That's useful context, but it doesn't address the commercial terms: whether the vendor can train on our data, what their liability is for AI errors, whether they notify us when the model changes. Do you have the service agreement or AI addendum?"

**Confirm document type** (AI addendum / main agreement AI provisions / ToS) before proceeding.

**Playbook and positions.** Apply any firm governance positions provided in the matter context or stated by the attorney in this conversation. If a position for a specific term has not been stated, ask one short question to get it, or apply a conservative default and flag the assumption explicitly. Never invent firm-specific positions as authoritative.

**If no matter is in context**, ask which matter or client this review is for so findings can be grounded appropriately.

---

## Step 1 — Map the AI stack

Before reading terms, map the vendor layers:

1. **End-user SaaS application** — the tool the firm is subscribing to
2. **API gateway / orchestration layer** (e.g., Azure OpenAI Service, AWS Bedrock, Google Vertex) — often invisible, always has its own terms
3. **Model provider** (e.g., Anthropic, OpenAI, Google, Meta) — the underlying large language model
4. **Hosted knowledge base / retrieval source** — any vector database or third-party data corpus the vendor uses
5. **Additional subprocessors** — analytics, logging, fine-tuning partners

Ask (if not already clear): "Walk me through the stack — what does [vendor] use under the hood? Is it built on a cloud AI service? Does it call a model provider directly or through a gateway?"

Review terms at **each layer**, not just the top. Each handoff between layers is a flow-down risk. A commitment at layer 1 ("we won't train on your data") means nothing if layer 3's terms say otherwise and layer 1 never flowed the commitment down.

---

## Step 2 — Term-by-term review

Review each of the following terms. For each, extract what the vendor's contract actually says and compare it against any firm position in context. If no firm position has been stated for a term, apply a conservative default and flag it.

| Term | What to look for |
|---|---|
| **Training on our data** | Does the vendor use inputs to train, fine-tune, or improve models? Is there an explicit opt-out or prohibition? Is training opt-in or opt-out by default? |
| **Confidentiality of inputs** | Are prompts, documents, and data confidential? Any "quality review" or human-review carveouts that would let vendor staff read inputs? |
| **Model changes** | Any notice obligation for material changes to the model? Is version pinning available? |
| **Output ownership / IP** | Who owns AI-generated content? Any license-back to the vendor on outputs? Any IP indemnity? |
| **Liability for outputs** | Does the vendor accept any liability if the AI produces harmful, incorrect, or infringing outputs? Cap structure? Carve-outs? |
| **Incident notification** | How and when is the firm notified if the AI system fails, is compromised, or produces systematic errors? |
| **Human review rights** | Can the firm require human review of outputs in specific cases? Any right to appeal or dispute an AI decision? |
| **Use restrictions** | What is the firm prohibited from doing? Does it match the intended use? Any definitional terms (e.g., "automated decision-making") that could sweep in intended uses? |
| **Audit / auditability** | SOC 2, third-party audits, bias testing results — any audit rights? |
| **Subprocessors / model providers** | Does the vendor use sub-vendors for the model? Are they disclosed? Whose terms govern? |
| **Data residency** | Where is data processed? Where does it go for inference? |
| **Term and termination** | What happens to data when the relationship ends? Deletion timelines? |
| **Stacked-vendor accountability** | Is this vendor the model provider, or a deployer of someone else's model, or a reseller of infrastructure-hosted foundation models? If the latter, there are TWO vendors' terms in play. Identify (a) whose terms govern training on inputs, retention, and safety; (b) who is contractually liable for model behavior; (c) whether each upstream commitment is flowed down, or remains only between the vendor and the upstream provider. Flag any clause where one party disclaims responsibility for the other and whether the counter-party's contract closes the gap. Do not review the two contracts in isolation. |

If the attorney has not stated a position for a term, note: "No firm position was provided for [term] — I've applied a conservative default: [state the default]. Please confirm or correct."

---

## Step 3 — Flow-down test

For each flagged stacked-vendor term — especially training-on-data, data retention, subprocessor changes, and liability — perform the flow-down test rather than simply noting the risk:

1. **Search the contract for flow-down language.** Look for: "subprocessor obligations no less protective than," "flow-down of data commitments," "back-to-back terms," "Provider shall ensure that its subprocessors are bound by," "equivalent obligations."
2. **If present:** Quote the language, verify it covers the specific flagged term, and flag whether it is enforceable by the firm directly or only by the intermediate vendor.
3. **If absent:** Produce a specific redline requiring it:
   > "Add to §[X]: Provider shall ensure that any third-party model providers, infrastructure providers, or subprocessors used in delivering the Services are bound by obligations with respect to [Customer Data / AI training / data retention / confidentiality] no less protective than those set forth in this Agreement, and shall be responsible for any breach of this Agreement caused by such third parties."
4. **Severity:** Flag 🔴 if the missing flow-down covers training-on-data or liability; 🟡 if the term is less sensitive or there is partial flow-down.

---

## Step 4 — AI addendum gap check

**If there is a DPA but no AI addendum:**

> "There's a DPA in place but no AI-specific addendum. The DPA covers data protection obligations but doesn't address: training on data, model change notification, liability for AI outputs, or incident notification for AI system failures. For a Standard tier use case this gap may be acceptable; for Elevated or High tier it is a blocker. Recommend requesting an AI addendum or negotiating AI-specific terms into the next renewal."

**If there are no AI terms at all:**

> "There are no AI-specific terms in this agreement. The vendor is providing an AI-powered service under general service terms — no contractual protection on training, liability, or model changes. This is 🔴 for any Elevated or High tier use case."

---

## Step 5 — AI policy consistency check

Cross-check the vendor's terms against any AI policy commitments the firm has stated in context. Common conflicts to surface:

- The firm prohibits vendor training on its data — the vendor's terms permit it by default.
- The firm requires human review for certain use cases — vendor's terms state AI outputs are final.
- The vendor is not on an approved vendor list or is on a blocklist.
- The firm's policy requires disclosure to affected parties — vendor's terms impose confidentiality on AI system capabilities that would prevent disclosure.

Flag every mismatch. One of them has to change.

---

## Redline guidance

**Edit at the smallest possible granularity.** A redline is a negotiation artifact, not a rewrite. Surgical redlines signal "we have specific asks" and are faster to accept.

Default hierarchy:
- Replace a **word** before a phrase
- Replace a **phrase** before a sentence
- Restructure a **subclause** before replacing the sentence
- Replace a **sentence** before replacing the clause
- Replace a **whole clause** only when the counterparty's version is so far from the needed position that surgical edits would be harder to read than a fresh draft — and when doing so, say so in the transmittal

---

## Output format

Present the result in chat for the attorney to review (and save in the app if they choose).

> *This review is derived from vendor contract terms that are typically confidential under NDA, and it may itself be privileged. It inherits the source's confidentiality and privilege status. Distributing it beyond the privilege circle — forwarding to the vendor, sharing in an open channel — can waive privilege and breach the NDA. Mark, store, and route accordingly.*

```
# Vendor AI Review: [Vendor Name]

**Document reviewed:** [AI addendum / main agreement AI provisions / ToS]
**Reviewed:** [date]
**Use case(s):** [what the firm is deploying this vendor's AI for]
**Governance tier:** [Standard / Elevated / High]
**Jurisdiction assumption:** North Carolina / US (flag if different)

---

## Bottom line

[Two sentences. Can the firm deploy under these terms? What must change first?]

**Issues:** [N]🔴 [N]🟠 [N]🟡 [N]🟢

---

## AI stack map

[Describe the vendor layers identified]

---

## Term-by-term

[For each term: vendor position, firm position, gap, severity, proposed fix — using the format below]

**[Term name]**
🟢 / 🟡 / 🟠 / 🔴
**Vendor says:** [summary of what the contract actually says]
**Firm position:** [stated in context, or conservative default flagged]
**Gap:** [specific delta — or "Aligned"]
**Proposed fix:** [specific redline language, or "escalate — outside fallback"]

---

## AI addendum status

[Present / Absent — and what that means for this deployment]

---

## AI policy consistency

[🟢 Consistent | 🟡 Flags: list]

---

## Recommended redlines

[Consolidated draft redlines. Review with the attorney before sending externally. For critical issues where no fallback exists, flag for escalation rather than proposing language.]

---

## If they won't move

[For each 🔴 and 🟠: the acceptable fallback, or "escalate — outside fallback" with routing recommendation]

---

## Next steps

Provide a short decision tree with the likely options: (a) redline and send back, (b) escalate the critical items to [appropriate party], (c) gather more facts (e.g., obtain the upstream model provider's DPA), (d) defer to renewal with documented gaps flagged to the attorney, (e) other. The attorney picks.
```

---

## Severity ratings

- 🟢 **Aligned** — at or better than the firm's standard position.
- 🟡 **Note** — within fallback but worse than standard; flag for awareness, not a blocker.
- 🟠 **Significant** — outside standard position but within fallback; needs redline before signing.
- 🔴 **Critical** — outside fallback; deployment should not proceed without resolution. Escalate.

---

## Signature gate

Before recommending signature of a vendor AI agreement (the version the firm will execute), confirm:

> "Signing this vendor AI agreement has legal consequences. The attorney should review the complete set of findings above before executing. If any 🔴 items remain unresolved, the attorney should decide whether to accept, escalate, or decline — that decision is theirs to make, not mine to make."

Do not recommend signature on any agreement with unresolved 🔴 findings unless the attorney explicitly states they have reviewed and accepted the risk.

---

## Practical notes

**The training-on-data clause is the one most people miss.** Vendor AI terms vary widely on whether API inputs can be used to train or improve models. Do not assume any particular vendor's current stance without reading the specific agreement. This must be confirmed in writing, not assumed from reputation or prior experience.

**Acceptable use policies flip the frame.** AUPs tell you what you can't do; they don't tell you what the vendor can do. A clean AUP review does not substitute for reading the data use and liability terms.

**Renewals are leverage points.** If the current agreement is unfavorable and the vendor won't renegotiate mid-term, document the gaps now and flag them for the renewal.

**Builder context adds a layer.** If the client is a builder using a vendor's model as a foundation, the vendor's terms also govern what the client can offer its own customers. Check use restrictions against the product roadmap, not just current internal workflows.

**Research limits.** This assistant uses web search and any documents provided by the attorney. It does not have access to Westlaw, Bloomberg Law, or contract analytics platforms. For complex multi-document vendor stacks, the attorney should consider obtaining the full upstream terms directly.

---

## What this skill does not do

- It does not review the DPA provisions of the same agreement — run a DPA review separately for data protection obligations.
- It does not decide whether to accept terms outside the fallbacks — it routes those to the attorney for decision.
- It does not evaluate vendor security posture beyond what is in the agreement — that is a security team function.
- All outputs are drafts for attorney review; none constitute legal advice or a legal opinion.
