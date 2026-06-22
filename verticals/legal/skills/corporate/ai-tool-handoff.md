---
slug: corporate.ai-tool-handoff
name: AI Bulk Review Tool Handoff and Quality Assurance
practice_area: corporate
description: Manages handoff to bulk AI review tools (Luminance, Kira, or similar) for high-volume clause extraction during diligence, then QA's the output and applies the judgment layer the tool cannot.
when_to_use: When the attorney mentions sending documents to Luminance, Kira, or a similar bulk AI review tool, when a diligence category has more than ~50 contracts, or when the attorney asks to batch-extract a clause type (e.g., change of control, assignment, MFN) across a large document set.
user_invocable: true
---

# AI Bulk Review Tool Handoff and Quality Assurance

> **Every output you produce is a draft for the attorney's review — not legal advice and not a legal opinion. The attorney owns the legal conclusion.**

> **Privilege destination check:** All QA summaries and findings produced here inherit the privilege and confidentiality status of the underlying documents. Before sharing, confirm the recipient is within the privilege circle. Distribution outside that circle can waive privilege.

> **Jurisdiction assumption:** Analysis below defaults to North Carolina / US law unless another jurisdiction is provided. If a jurisdiction is relevant and none is given, surface that assumption and ask.

---

## Purpose

Bulk AI review tools (Luminance, Kira, and their equivalents) are good at one thing: reading 500 contracts and finding every change-of-control clause. They are less good at judgment — deciding whether a particular CoC provision is actually triggered by this deal structure.

This skill manages the handoff to that tool, then runs the QA layer on what comes back.

**Before you hand off:** consider whether the volume actually requires a dedicated tool. For smaller corpora (a few dozen documents, a well-defined column schema), offer to run a tabular review directly in chat using documents the attorney uploads or pastes. Reserve the formal handoff for situations where the corpus is genuinely large, the attorney's team already has a tool license and workflow, or the matter requires a validated provenance chain.

---

## Matter context

If a matter or client is in your context, ground all output in it. If no matter is in context and the attorney hasn't specified one, ask: "Which matter is this for?" before proceeding.

---

## When to hand off to the external tool

Hand off when all of:
- The category has more than ~50 documents (below that, reading directly is often faster)
- The extraction target is a clause type bulk tools handle well: change of control, assignment, exclusivity, most-favored-nation (MFN), termination, auto-renewal
- Documents are reasonably uniform (e.g., all customer contracts on similar paper — not a mix of contracts, letters, and board minutes)

**Do not hand off:**
- Bespoke or heavily negotiated documents
- Side letters and amendments (context-dependent; tools miss the interaction with the main agreement)
- Anything where the question is "what does this mean for the deal" rather than "does this clause exist"

---

## Step 1 — Prepare the batch

Ask the attorney to confirm:
1. Which documents (or VDR folder path) make up the batch
2. Which clause types to extract
3. The materiality threshold for flagging

If the attorney has not stated a trust level for the tool (use as-is / spot-check / full re-review), ask one question: "How much do you trust the tool's output — should we use it as-is, spot-check a sample, or have a human read every flagged document?" Flag your assumption explicitly if you proceed without an answer.

---

## Step 2 — Generate the load request

Produce a load request the attorney or their team can send to whoever operates the tool:

```markdown
## [Tool Name] Load Request — [Deal Code] — [Category]

**Documents:** [N] docs from [VDR folder or source]
**Load to:** [Tool workspace / matter]
**Extraction targets:**
- Change of control / assignment
- Exclusivity
- [Additional clause types per attorney instruction]

**Filter output:** Flag only where an extraction target is present — no need for "no CoC clause found" on every clean document.

**Return by:** [Date]
```

Present this in chat for the attorney to copy, send, or adjust. If the attorney's firm does not use a dedicated bulk review tool, note that and proceed directly to Step 4 using documents provided in the conversation.

---

## Step 3 — QA the output

When the tool returns results (attorney pastes or uploads them), apply the trust level:

**Use as-is:** Ingest directly into diligence findings. Only proceed this way if the attorney has explicitly said to — this is rare and should be flagged as an assumption if you reach this path without confirmation.

**Spot-check X%:** Randomly sample X% of flagged documents. For each, read the actual clause and compare it to the tool's extraction. If the error rate is low, accept the batch. If errors are found, widen the sample and report back. Ask the attorney for the documents to review if they are not already in context.

**Full human review of flagged:** The tool narrows the universe (e.g., 500 docs → 80 with CoC clauses). A human reads all 80. The tool's value was eliminating the time spent on the 420 clean documents. If in-context documents are available, you can assist with that review directly.

---

## Step 4 — Apply the judgment layer

The tool found the clauses. Now apply judgment — this is what the tool cannot do.

For each flagged provision, work through:
- **Transaction structure match:** Stock sale vs. asset sale vs. merger triggers different CoC definitions. Confirm which applies.
- **Contractual definition of "change of control":** Majority ownership? Board control? Something else? Read the definition in the contract, not just the operative clause.
- **Carve-outs:** Is there an explicit carve-out for this transaction type or for transactions involving a parent/affiliate?
- **Materiality:** Does the flagged clause meet the materiality threshold set at Step 1?

Document your reasoning for each judgment call. The attorney reviews and owns the conclusion.

---

## Output — QA Summary

Present the following summary in chat for the attorney to review. If they want to save it in the app, they can do so from here.

```markdown
## AI Tool Handoff Summary — [Category] — [Matter/Deal Code]

**Tool:** [Luminance / Kira / Other / Not used — reviewed in chat]
**Documents processed:** [N]
**Extraction targets:** [Clause types]

### QA

**Trust level applied:** [Use as-is / Spot-check X% / Full re-review of flagged]
**Sample reviewed:** [N] documents
**Error rate observed:** [X]% — [Accepted / Sample widened / Full re-review triggered]

### Results

| Clause type | Docs flagged by tool | After judgment layer | Material (above threshold) |
|---|---|---|---|
| Change of control | [N] | [N actually triggered by deal structure] | [N] |
| Assignment | [N] | [N] | [N] |
| [Other] | [N] | [N] | [N] |

**Findings added to diligence issues:** [N]
**Consents added to closing checklist:** [N]

*Draft for attorney review — not legal advice. Privilege: treat as work product; do not distribute outside the privilege circle.*
```

---

## Next steps

After presenting the summary, offer the attorney a short decision tree:

1. **Draft diligence findings** for the material flagged items
2. **Add consent requests to the closing checklist**
3. **Escalate** any items above the materiality threshold that need immediate deal-team attention
4. **Widen the QA sample** if the error rate warrants it
5. **Something else** — describe what you need

---

## What this skill does not do

- It does not run Luminance, Kira, or any external tool — it manages the handoff and QA in chat. The attorney or their team operates the tool itself.
- It does not replace the tool's output with its own independent extraction — if a spot-check is specified, it checks that sample, not the entire corpus.
- It does not set the trust level — the attorney decides how much to rely on the tool's output. If no trust level is given, ask.
- It does not have access to Westlaw, CoCounsel, Ironclad, iManage, or other matter-management platforms. Use web_search for general legal research and rely on documents the attorney provides for contract-specific analysis.
