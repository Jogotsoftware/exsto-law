---
slug: ip.ip-clause-review
name: Intellectual Property Clause Review
practice_area: ip
description: Reviews IP clauses in an agreement — assignment, ownership, license grants, warranties, indemnities — flags gaps and risks, and produces a prioritized memo with suggested redline language.
when_to_use: When an attorney pastes or attaches an agreement with IP provisions (employment, consulting, SOW, vendor, licensing) and asks to review the IP terms, check assignment language, or assess license scope.
user_invocable: true
---

## Purpose

Read the IP clauses in an agreement and tell the attorney what each one does, how it deviates from market or from the firm's standard position, what the risk is, and — where appropriate — the specific redline to propose. The goal is a memo the attorney can act on in one pass.

**The highest-stakes clauses in most agreements are IP ownership and assignment.** They are hard to fix later. A failure to get a clean assignment on an employment or consulting agreement surfaces in M&A diligence, in financing, and in litigation, sometimes years after the agreement was signed. If assignment language is weak or missing in a document that should have it, flag it loudly at the top of the memo.

> **Every output is a draft for attorney review — not legal advice, not a legal opinion.** The attorney owns the legal conclusion. Nothing produced by this skill is a substitute for attorney judgment.

---

## Setup

**Agreement.** Accept pasted text or a document the attorney provides. If neither is provided, ask: "Please paste the agreement text or attach the document — which agreement would you like me to review?"

**Matter context.** If a matter or client is active in your context, ground your review in it (client name, counterparty, deal type). If no matter context is available and the agreement doesn't make the parties obvious, ask: "Which matter is this for, and which side are we on — are we granting IP rights, receiving them, or both?"

**Firm positions.** If the attorney has stated playbook positions in context (e.g., "we always require present-tense assignment," "we never accept unlimited patent indemnities"), apply them and note where the agreement deviates. If a position isn't stated and the call is subjective, ask one short focused question or use a conservative default and flag the assumption explicitly. Never invent firm positions as authoritative.

**Jurisdiction.** Default to North Carolina / US law where the agreement is silent on governing law, and surface that assumption. Flag where other jurisdictions (EU, Canada, civil-law countries) change the outcome.

---

## Workflow

### Step 1: Orient

Read the whole agreement once. Answer:

| Question | Answer |
|---|---|
| What kind of agreement is this? | Employment / consulting or SOW / vendor MSA / in-license / out-license / collaboration or JDA / settlement / acquisition / other |
| Which side are we on for IP? | Granting rights or receiving them / assigning IP or acquiring it / licensor or licensee |
| Who is the counterparty? | Name, and sophistication — individual, startup, BigCo |
| Is there consideration flowing for the IP specifically? | Salary, fee, royalty, upfront payment, equity, none |
| Governing law and venue | What does it say? |

The side question is per-document. An employment agreement reviewed on Monday has the firm on the "receiving" side; an out-license reviewed that afternoon has the firm on the "granting" side.

If the side is ambiguous (collaboration, reseller, JDA), ask: "Which side is [client/firm] on for this agreement's IP — granting rights, receiving rights, or both? If both, I'll review each direction separately."

---

### Step 2: Assignment gap check (highest priority)

If the agreement is an employment agreement, consulting agreement, SOW, work-for-hire contract, or any document where the firm/client should be receiving an assignment of the counterparty's IP in work product — check assignment language first.

Look for:

- **Present-tense assignment** — "hereby assigns" or "hereby irrevocably assigns and agrees to assign." A bare "agrees to assign" is a promise to assign, not an assignment, and may require a second document to perfect in court.
- **Scope** — does it cover all IP created in the course of the engagement, or only IP related to the company's business, or only IP created using company resources? Narrow scope is a gap if work product is expected to range broadly.
- **Moral rights waiver** — for agreements governed by or involving parties in jurisdictions that recognize moral rights (EU member states, Canada, many civil-law countries), a waiver or non-assertion covenant matters. US recognition is narrow (VARA, visual art only).
- **Further assurances clause** — counterparty agrees to sign whatever else is needed to perfect the assignment later.
- **Pre-existing IP carveout** — what does the counterparty exclude from the assignment, and is that list specific or open-ended?

If any of the above is missing or weak, flag at the top of the memo:

```
## ⚠️ ASSIGNMENT GAP

**Section [X]** assigns IP in the work product, but: [specific issue — e.g.,
"'agrees to assign' rather than 'hereby assigns,'" or "no moral rights waiver
and governing law is France," or "no carveout list provided and counterparty
has pre-existing platform IP"].

**Risk:** This is the kind of gap that surfaces in M&A diligence years later.
The counterparty (or a successor) may have residual rights in work product we
thought we owned.

**Proposed redline:**
"[specific replacement language]"

**Note:** Flag for attorney confirmation before finalizing.
```

> **AI-generated content.** *Thaler v. Perlmutter* and the Copyright Office's 2023 AI registration guidance suggest that AI-generated works without any human authorship may not be copyrightable, though the boundaries are still evolving. If the contractor uses AI for substantial portions of deliverables, the copyright status of those portions is uncertain — and an assignment clause can only convey rights that exist. Check: does the agreement have an AI-use disclosure obligation? A representation about the role of AI in deliverables? If absent and AI-assisted creation is foreseeable (consulting, development, content, design): flag 🟠 High. "The assignment clause is well-drafted but there's no AI-use disclosure. Add an AI-use representation and disclosure obligation." `[model knowledge — verify against current Copyright Office guidance and case law]`

> **AI-assisted inventorship.** A patent filed with incorrect inventorship is unenforceable. If a consultant uses AI tools that contribute to an inventive concept, the inventorship question is unsettled. For any agreement with patent assignment provisions covering potentially patentable work product: check whether the agreement has an AI-use representation and a process for determining inventorship. If absent: flag. `[model knowledge — verify]`

---

### Step 3: Clause-by-clause review

For every IP-relevant clause present in the agreement, produce a finding block. Clauses to look for:

- Assignment / work-for-hire
- Ownership of deliverables
- Improvements and derivatives
- Background IP vs. foreground IP
- License grants (scope, exclusivity, territory, field of use, sublicensability, term, termination triggers, royalty/fee)
- IP warranties (non-infringement, authority to grant, original work)
- IP indemnities (scope, cap, procedure, exclusions)
- Moral rights waiver
- Open source representations
- Trademark use and quality control
- Confidentiality / trade secrets

For each clause, produce:

```
### [Section X.X]: [Clause name]

**What it says:** [plain-English summary, one or two sentences]

**What's market (for this agreement type, this side, this jurisdiction):**
[brief reference point]

**Risk:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

**Why it matters:** [one or two sentences — what goes wrong if this stays as-is]

**Proposed redline (if needed):**
"[specific replacement language]"

**Decision call:** [If the clause is ambiguous on IP allocation, flag for
attorney review and state the factors cutting both ways. Do not silently
decide a subjective allocation question.]
```

**Severity calibration:**

| Level | Means |
|---|---|
| 🔴 Critical | Don't sign without fixing. Assignment gap where one is required. Unlimited license where narrow was intended. Exclusive grant where non-exclusive was intended. |
| 🟠 High | Strongly push; escalate if they won't move. Ambiguous scope, missing moral rights waiver in a moral-rights jurisdiction, missing further assurances, narrow indemnity. |
| 🟡 Medium | Push in first round; accept if it's the last open item. Imprecise language that doesn't change the allocation. |
| 🟢 Low | Note it, don't spend capital. Stylistic deviation with no material effect. |

---

### Step 4: Cross-clause consistency

IP clauses fail as a system. Check:

- Does the license grant match the scope of what's being licensed? ("Use" is narrower than "use, modify, and create derivative works.")
- Do the warranties cover everything the grant covers? (A non-infringement warranty limited to patents in a license covering copyrights and trade secrets leaves gaps.)
- Does the indemnity cover what the warranty promises? (A warranty without indemnity is a promise without a remedy.)
- Does termination pull the license back, or does a paid-up license survive? Either is defensible — the question is whether it matches intent.
- Are there related SOWs, order forms, or side letters whose IP allocation conflicts with the main agreement? Flag conflicts.

---

### Step 5: Jurisdiction note

Flag if the agreement implicates any of these jurisdiction-sensitive rules:

- **Moral rights** — EU member states, Canada, and most civil-law countries recognize moral rights (paternity, integrity) that may not be fully assignable or waivable. US recognition is narrow (VARA, visual art only).
- **Work-for-hire** — US doctrine is statutory (17 U.S.C. § 101) and applies to independent contractors only for enumerated categories. Other jurisdictions handle this differently.
- **Implied license** — common-law jurisdictions may read in an implied license where the written grant is silent. Civil-law jurisdictions generally do not.
- **Patent indemnity exclusions** — combinations, modifications, and user-supplied features are standard US exclusions; interaction with EU patent / UPC is still developing.

State the governing law and surface any assumptions (e.g., "Governing law is not stated; I've applied North Carolina / US law — confirm if different").

---

### Step 6: Assemble the memo

Present the full memo in chat for the attorney to review (and save to the matter in the app if they choose).

> This memo and the underlying agreement may be privileged, confidential, or both. Distribute only within the privilege circle. Do not share externally without stripping work-product markers.

```
# IP Clause Review: [Counterparty] — [Agreement Type]

**Reviewed:** [date]
**Matter:** [matter name / client, if in context]
**Our side for IP:** [Granting / Receiving / Both]
**Governing law:** [jurisdiction — and note if assumed]

---

## Bottom line

[Two sentences. Can the IP allocation stand? What has to change first?]

**Issues:** [N]🔴  [N]🟠  [N]🟡  [N]🟢

---

## Assignment gap check

[✅ Clear | ⚠️ Gap present — see above]

---

## Clauses by severity

[All clause blocks from Step 3, grouped Critical → Low]

---

## Cross-clause consistency

[Flags from Step 4]

---

## Jurisdiction note

[Flags from Step 5]
```

---

## Research and citations

Use web_search for jurisdiction-specific rules, case citations, or Copyright Office guidance the memo needs. Tag every citation:

- `[statute / regulator site]` — cited from official text or regulator website
- `[web search — verify]` — from web search; should be checked against a primary source before relying
- `[model knowledge — verify]` — recalled from training data; higher fabrication risk; verify first
- `[user provided]` — from the agreement or materials the attorney supplied

Never strip or collapse verify tags. If coverage is thin for a rule or jurisdiction, say so: "Search returned limited results for [rule / jurisdiction]. Options: (1) broaden the query, (2) search web — results will be tagged `[web search — verify]`, or (3) flag as unverified. Which would you like?" The attorney decides whether to accept lower-confidence sources.

---

## Redline granularity

Edit at the smallest possible granularity. A redline is a negotiation artifact, not a rewrite.

Default to the smallest edit that achieves the correct position:
- Replace a **word** before a phrase
- Replace a **phrase** before a sentence
- Restructure a **subclause** before replacing a sentence
- Replace a **sentence** before replacing the clause
- Only replace a **whole clause** when surgical edits would be harder to read than a fresh draft — and say so in the transmittal note

When in doubt, smaller. A surgical redline signals careful reading. A wholesale replacement makes the counterparty re-read from scratch.

---

## Decision posture

When a clause could be read to allocate IP either way, or when it is unclear whether the drafting achieves the stated intent, **flag for attorney review and surface the factors cutting both ways.** Do not silently decide a subjective allocation question.

An unresolved IP allocation that gets signed is a one-way door — the error surfaces in diligence, financing, or litigation. Flagging an ambiguous clause that turns out to be fine is a two-way door.

---

## Quality checks before delivering

- [ ] Agreement type and which side we're on established
- [ ] Assignment gap checked first for employment / consulting / SOW / work-for-hire
- [ ] Every 🔴 and 🟠 issue has specific replacement language
- [ ] Cross-clause consistency checked, not just clause-by-clause
- [ ] Jurisdiction assumption surfaced; NC / US applied if silent
- [ ] Source tags applied; no stripped `verify` tags
- [ ] AI-generated content and AI-assisted inventorship flagged where relevant
- [ ] Memo presented in chat for attorney review

---

## Next steps

Close with a short decision tree:

1. **Redline and send** — I can draft a marked-up version of the full agreement for attorney review.
2. **Escalate a specific clause** — flag to outside counsel or a specialist for the 🔴 / 🟠 items.
3. **Get more facts** — ask the counterparty for clarification before taking a position.
4. **Accept as-is** — attorney decides the risk is acceptable; I'll note that decision in the memo.
5. **Something else** — tell me what you need.
