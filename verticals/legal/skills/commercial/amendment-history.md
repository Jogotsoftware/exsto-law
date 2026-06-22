---
slug: commercial.amendment-history
name: Contract Amendment History
practice_area: commercial
description: Trace how a contract has changed across its base agreement and all amendments — summarizing all changes over time or tracing a specific provision to its current controlling language.
when_to_use: Attorney uploads multiple contract versions, asks what changed over time, wants to find the current language of a specific clause, or asks how a provision has evolved across amendments.
user_invocable: true
---

# Contract Amendment History

Loads a base agreement and all amendments the attorney provides, then either summarizes what changed over time or traces a specific provision to its current controlling language.

> **Every output is a draft for attorney review — not legal advice and not a legal opinion.** The attorney owns the legal conclusion. Do not file, send, sign, or rely on any output without attorney review and sign-off. This output is work product; distribute only within the privilege circle. Strip any privilege header before external delivery.

---

## How to invoke

Provide the base agreement and all amendments — paste the text, upload the files, or both. Say which mode you want, or let the assistant detect it from your request:

- **Summary mode:** "What changed in this contract over time?" / "Show me the amendment history."
- **Provision trace:** "Where's the current indemnity language?" / "How has the liability cap changed?"

If you have an active matter in context, the assistant grounds the analysis in it. If not, say which matter or client this is for.

---

## Step 1: Get the documents

Accept documents from any of these sources:
- Text or files pasted or uploaded directly in chat.
- Links or excerpts the attorney provides.

If no documents are provided, ask: "Please share the base agreement and any amendments — paste the text or upload the files."

Use web_search only if the attorney explicitly asks for publicly available background on the agreement type or counterparty — this skill is an analysis of the documents you are given, not a research task. Note the limitation when web_search is used in place of a specialized contract database.

---

## Step 2: Detect the mode

Parse the attorney's request to determine which mode to run. Do not ask which mode unless the request is genuinely ambiguous.

**Mode 1 — Summary** (no specific provision mentioned)
Trigger phrases: "what changed," "amendment history," "show me changes over time," "summarize amendments," "what does this contract look like now."

**Mode 2 — Provision trace** (specific clause or topic named)
Trigger phrases: "where's the [clause]," "latest [provision]," "how did [term] change," "find the indemnity," "what does it say now about [topic]."

Common provision mappings:
- "indemnity" / "indemnification" → indemnification section
- "liability" / "liability cap" → limitation of liability
- "termination" → term and termination
- "data" / "privacy" / "DPA" → data protection provisions
- "IP" / "intellectual property" → IP ownership and licenses
- "price" / "fees" / "payment" → payment terms
- "auto-renewal" / "renewal" → renewal mechanics

If the term maps to more than one provision, list the candidates and ask:
> "I found [N] provisions related to [term] — [list them]. Which one?"

If the overall request is ambiguous between modes, ask one question:
> "Summary of all changes across the contract, or trace a specific provision — like indemnity, liability, or termination?"

---

## Step 3: Order the documents

Establish chronological order before reading content.

**Ordering rules:**
- Use execution dates in document headers or recitals ("This Amendment, dated as of…") if available.
- Document titles ("Amendment No. 1," "Second Amendment," "Addendum A") and numbered suffixes are reliable signals — proceed without asking when they are clear.
- Amendments often reference the agreement they modify ("this Amendment to the Master Services Agreement dated [X]") — use these references to confirm the chain.

Only ask the attorney to confirm ordering if:
- Filenames or titles give no indication of sequence.
- Dates are absent from both filenames and document headers.
- Two documents appear to be the same amendment version.

If ordering was inferred rather than confirmed, note it at the top of the output only where uncertain:
> "Order inferred from document titles — one item I was less certain about: [specific document]. Please confirm if this affects your review."

---

## Step 4: Read and index

Read each document in chronological order. For each, extract:
- Document type (base agreement, amendment number, addendum, etc.)
- Execution date
- Parties (confirm they match across documents — flag if a new party was added or a party name changed)
- A list of provisions explicitly modified, added, or deleted

Build a working index before producing output. Use it internally to drive the output — do not show it to the attorney.

**Jurisdiction note:** If the governing law clause is present, surface it and use it to frame any jurisdiction-sensitive analysis. If no governing law is stated, flag the absence and note that the governing jurisdiction is unknown [verify the applicable jurisdiction with the attorney before drawing any jurisdiction-sensitive conclusions].

---

## Mode 1: Summary of all changes

### Section reference rule

Every finding must include an inline section reference so the attorney can verify against the source document without searching:

> "Termination for convenience (§12.3): Added. Customer may terminate on 90 days written notice with no fee after the initial term."

If a provision spans multiple sections or the section number changed across amendments, cite all references:
> "Indemnification (§9.1 base; §9.1 restated in Amendment 5)"

### Output format

```
# Amendment History: [Counterparty] — [Agreement type]

**Base agreement:** [date]
**Amendments:** [N] ([date of first] → [date of last])
**Last amended:** [date]

---

## What changed — chronological

### Amendment 1 — [date]
**Purpose:** [one sentence — why this amendment existed, from recitals or
clear from context. If not stated, omit rather than guess.]

**Material changes:**
- [Provision] (§[X.X]): [what it said before → what it says now, in plain English]
- [New provision added] (§[X.X]): [what it does]
- [Provision deleted] (§[X.X]): [what was removed and why it matters]

### Amendment 2 — [date]
[same structure]

[repeat for each amendment]

---

## Net current state

| Provision | Current position | §Ref | Last changed |
|---|---|---|---|
| [clause] | [plain English summary] | §[X.X] | Amendment N, [date] |
| [clause] | [unchanged from base] | §[X.X] | Base agreement |

---

## Watch items
[Flag anything that looks inconsistent — e.g., an amendment modifying a
provision that was already deleted, contradictory language between amendments,
a party name that changed without a formal assignment, or a provision where
the section number shifted across documents. Include section references on
every flag.]
```

---

## Mode 2: Provision trace

Show only what changed. Do not list amendments where the provision was untouched — skip them entirely.

### Output format

```
# Provision Trace: [Provision name]
## [Counterparty] — [Agreement type]

---

### Original — [Base agreement date], §[X.X]
> "[exact quote]"

*Plain English:* [one sentence]

---

### Amendment [N] — [date], §[X.X]

**Was:**
> "[exact quote of prior language]"

**Now:**
> "[exact quote of replacement language]"

*What changed:* [one sentence — practical effect on the parties]

---

[Only subsequent amendments that touched this provision appear here.
All others are omitted.]

---

## Current controlling language

**§[X.X] — [source document, date]**
> "[exact quote]"

*Plain English:* [one sentence]

---

## Watch items
[Flags, inconsistencies, open questions — with section references.
Common items to check: whether the provision is subject to or carved out of
the liability cap; whether the section number shifted across amendments;
whether the amendment language conflicts with another provision.]
```

If the provision was never amended after the base agreement:
> "This provision has not been modified by any amendment. Original language controls. §[X.X], base agreement, [date]."

---

## After the output — offer follow-ups

Present the result in chat for the attorney to review and save in the app if they choose. Then offer:

- "Want me to trace another provision?"
- "Want a full playbook review of the current agreement as amended?"
- "Want a plain-language stakeholder summary of the key changes?"

---

## What this skill does not do

- It does not determine which document controls in the event of a conflict between the base agreement and an amendment — that is a legal interpretation question for the attorney.
- It does not draft new amendments.
- It does not compare provisions against a firm playbook or negotiation positions — that is a separate contract review task. If the attorney provides their standard positions in context, flag deviations; if not, ask or use a conservative default and flag the assumption.
- It does not infer what ambiguous amendment language means — it quotes exactly and flags ambiguity for the attorney to resolve.
- It does not access external contract management systems (CLM, iManage, Ironclad, etc.) — work from the documents provided directly.
