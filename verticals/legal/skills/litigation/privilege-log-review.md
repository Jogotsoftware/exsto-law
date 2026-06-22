---
slug: litigation.privilege-log-review
name: Privilege Log Review
practice_area: litigation
description: First-pass attorney-client privilege and work-product review of a privilege log — sort obvious calls, flag close ones, and surface pattern problems before production.
when_to_use: When the attorney shares a privilege log, asks to "review the priv log," wants to QA document designations before production, or asks which withheld documents might need a closer look.
user_invocable: true
---

## Disclosed-document use restrictions

Before working with any litigation documents, confirm: were any of these documents obtained through disclosure or discovery in legal proceedings?

If yes:

- **Federal (FRCP):** Protective orders and Rule 26(c) may restrict use to the current proceedings. Check the operative protective order.
- **North Carolina state court:** Similar undertaking principles apply under the NC Rules of Civil Procedure. Check any court-issued protective order.
- **Other jurisdictions:** Confirm the controlling rule before proceeding.

If there is any doubt that this use is within the proceedings in which the documents were disclosed, flag it: "These documents may have use restrictions. Confirm this use is permitted before proceeding."

---

## Purpose

A privilege log has three kinds of entries: obviously privileged, obviously not, and the ones that need thought. This review sorts the first two kinds so the attorney's time goes entirely to the third.

**This is a first pass. The attorney reviews every flag. No exceptions. This output is a draft for attorney review — it is not a legal opinion and does not constitute legal advice.**

---

## Matter context

If a matter or client is active in your current context, ground the review in it. If no matter is in context, ask: "Which matter is this for?" before beginning substantive review.

Apply any firm positions, standing instructions, or matter-specific notes the attorney provides in the conversation. If a position relevant to a privilege call has not been given, ask one short clarifying question or apply a conservative default and explicitly flag the assumption.

---

## Record fidelity — citation standards

When citing a rule, local rule variant, or authority for a privilege call (FRCP 26(b)(5)(A), NC Rule of Civil Procedure, standing order, case on waiver scope, dominant-purpose doctrine), two rules apply.

**Pinpoint cites must support the whole proposition.** If a cite backs only part of a multi-element privilege position, split the cite or narrow the proposition. A cite that covers part of the position will be exposed by opposing counsel.

**Extract all citations before checking any.** When citations appear in this review or in materials the attorney provides for citation-checking:

1. **Extract first.** Build a complete list of every citation (rules, cases, statutes, local orders). Report the count.
2. **Check each one.** Use web_search to verify. Do not sample.
3. **Report coverage.** "Checked [N] of [M] citations. [K] could not be retrieved — verify manually. [J] confirmed. [I] flagged as potential miscitations. [H] flagged as misgrounded (cite exists but doesn't support the proposition as stated)."
4. **If the source text is unavailable, say "could not verify," never "confirmed."**
5. **Tag every authority** with its source: `[web search — verify]` for web-search results; `[user provided]` for attorney-supplied citations; `[model knowledge — verify]` for anything recalled from training data. Citations tagged "verify" carry higher fabrication risk — check those first. Never strip the tags.

---

## Step 0: Research the forum's privilege-log requirements

**Before reviewing entries**, identify:

- The controlling rule (FRCP 26(b)(5)(A) for federal matters; the NC equivalent for state court; the applicable local rule or judge's standing order).
- Required log fields and level of description.
- Any category-log or metadata-log accommodations.

Use web_search and any documents the attorney provides. If results are thin, report what was found and ask: "Coverage looks thin for [rule / doctrine]. Should I broaden the search, try a different source, or flag these calls as uncertain and stop?" The attorney decides whether to accept lower-confidence sources.

**Jurisdiction note.** This review defaults to the US federal framework (FRCP) and North Carolina state-court rules. If the matter involves a different forum, a transferred case, multi-jurisdictional production, or a choice-of-law question on privilege, surface that assumption before proceeding — the calls here may not transfer.

---

## Waiver doctrine

Waiver rules differ by privilege type — confirm the forum's doctrine for each privilege claimed before recommending production of anything.

- **Attorney-client privilege waiver** is often broad: subject-matter waiver can sweep in related communications on the same topic.
- **Work-product waiver** is narrower: courts typically distinguish opinion work product (stronger protection, waiver rarely implied) from fact work product. Waiver of fact work product does not automatically waive opinion work product.

---

## In-house counsel — jurisdiction-specific

Before classifying any in-house counsel communication as privileged:

- **US:** In-house counsel communications are generally privileged when made for the purpose of obtaining or providing legal advice and the attorney is acting in a legal (not business) capacity. The legal-vs.-business distinction is fact-specific and contested.
- **EU (competition / DG COMP proceedings):** Under *Akzo Nobel Chemicals v. Commission* (C-550/07 P), in-house counsel communications are **not** privileged in EU competition proceedings. If the matter involves EU regulators, flag every in-house document for review by a jurisdiction specialist.
- **Other non-US jurisdictions:** Confirm locally. Some civil-law systems extend little or no privilege to in-house lawyers.

**Never classify an in-house counsel communication as "confidently privileged" without stating which privilege regime applies.** When jurisdiction is unclear or non-US, route all in-house documents to the flagged tier — not the confident tier.

---

## The three-state rule

**The skill never silently decides a subjective threshold is not met.**

On any uncertain call — dominant purpose unclear, litigation contemplation borderline, mixed legal/business content, ambiguous third-party presence — keep the privilege designation **on** and add a ⚠️ flag for the attorney.

- Under-marking **waives** privilege (one-way door).
- Over-marking is **corrected** by the attorney in review (two-way door).

Prefer the recoverable error.

### Confidently privileged (✅) — keep designation, no flag

- Communication between client and outside counsel seeking or providing legal advice, no third parties copied.
- Communication between client and in-house counsel, clearly legal (not business) advice, no third parties, US jurisdiction confirmed.
- Work product created in anticipation of litigation, by or for counsel.
- Communications within the control group about legal strategy.

### Uncertain — keep designation AND flag (✅ + ⚠️)

The default for anything that isn't confidently in ✅ or ❌. Examples:

- **In-house counsel doing both legal and business** — dominant-purpose call is the attorney's.
- **Third party present** — is the third party within the privilege circle (common interest, agent) or does their presence waive? Flag for attorney.
- **Mixed-purpose documents** — part legal, part business. Partial redaction? Full withhold? Produce? Flag for attorney to decide the treatment.
- **Attachments** — analyze separately; keep each attachment's designation unless confidently ❌; flag subjective calls.
- **Pre-litigation work product** — "reasonable contemplation of litigation" is fact-specific; flag.
- **Waiver risk** — ambiguous sharing history; flag the waiver question.

Each flag records the specific open question and the evidence cutting each way, so the attorney can decide without re-reading the document cold.

### Confidently not privileged (❌) — recommend removal, attorney confirms

Only for unambiguous cases. The output records the assessment rationale; it does not remove the designation from the log on its own.

- No attorney involved anywhere.
- Business advice with a lawyer copied (CC'ing legal doesn't make it privileged).
- Underlying facts (facts aren't privileged — communications *about* facts can be).
- Third party copied who is clearly outside the privilege circle (breaks confidentiality).
- Attachments that are independently non-privileged (the email may be privileged; the attached sales spreadsheet is not).

If any of these is *close* — the third party might be an agent, the lawyer's copy might be on a legal request — route it to uncertain, not ❌.

---

## Workflow

### Step 1: Format check

Does the log contain the required fields?

| Field | Present? |
|---|---|
| Date | |
| Author | |
| Recipients (all — TO, CC, BCC) | |
| Document type | |
| Privilege claimed (A/C, WP, or both) | |
| Description (enough to assess without revealing privileged content) | |

Missing fields → flag for completion before substantive review.

### Step 2: Entry-by-entry

For each entry:

```
Entry [N] ([Bates]): [✅ Priv | ✅ Priv + ⚠️ Flag | ❌ Not priv (assessed)]
[If ✅ (no flag): one-line reason]
[If ✅ + ⚠️: keep designation; the specific question the attorney needs to answer; evidence cutting each way]
[If ❌: one-line reason — designation stays on the log until the attorney removes it]
```

**Never produce an entry that silently strips a privilege designation based on a subjective call.** A ❌ is a recommendation logged alongside the rationale; the attorney acts on it.

### Step 3: Pattern flags

Across the log:

- **Repeating issue?** (Same third party on 50 entries — one decision by the attorney resolves 50 flags.)
- **Over-designation?** (Everything designated without differentiation — surface it for the attorney, but the call to narrow the log is the attorney's.)
- **Under-description?** (Descriptions so vague a court would order in camera review — flag and recommend more specific language before service.)

---

## Output

Present the review in chat for the attorney to review and save in the app if they choose.

**Before the log is served on opposing counsel** (the consequential act — this includes serving the log AND designating documents as withheld or produced under a protective-order tier), confirm with the attorney that they have reviewed the ⚠️ and ❌ flags and are satisfied with the privilege designations. If the reviewing person is not a licensed attorney, surface this check explicitly:

> "Serving a privilege log and designating documents in discovery both have legal consequences — over-designation risks sanctions and credibility loss; under-designation risks waiver; a misdesignated production may be unrecallable. Please confirm a licensed attorney has reviewed the log before service."

---

```markdown
## Privilege Log Review: [Matter] — [Date]

**Applicable rule:** [FRCP 26(b)(5)(A) / NC Rule / local rule / standing order — pinpoint cites] `[source tag]`
**Entries reviewed:** [N]
**Results:** [N] ✅ confident priv / [N] ✅+⚠️ priv kept & flagged / [N] ❌ recommend remove (attorney confirms)

### ✅ + ⚠️ Flagged — designation kept, attorney decides

| Entry | Bates | Issue | Evidence for privilege | Evidence against | Question for attorney |
|---|---|---|---|---|---|
| [N] | [range] | [what is subjective] | [one line] | [one line] | [the specific call to make] |

### ❌ Recommend remove designation (attorney confirms before stripping)

| Entry | Bates | Reason |
|---|---|---|

*Recorded, not executed. The skill does not remove privilege designations — the attorney does, after reviewing the rationale.*

### ✅ Privileged (no action)

[Count. Full list available on request.]

### Pattern observations

[Repeating issues, over-designation, description problems]

### Marker discipline

- `[VERIFY: factual assertion about document, custodian, or date]`
- `[UNCERTAIN: close privilege call / waiver scope / doctrine question]`
- `[CITE NEEDED: rule, local variant, or authority supporting a call]`

---

**Attorney must review all ⚠️ and ❌ before any action.**

**Privileged source material.** This review reads entries and documents that are, by definition, privilege-candidate material. The review output inherits that status — keep it with privileged materials, mark it appropriately, and do not circulate outside the privilege circle. Distributing this review can itself waive protection.

**This review is a draft for attorney review. It is not a legal opinion and does not constitute legal advice. The attorney owns every privilege designation.**
```

---

## What this skill does not do

- Make close calls. ⚠️ means "a human decides." On any subjective test (dominant purpose, reasonable contemplation, common-interest scope, waiver by later sharing), the skill keeps the privilege designation on and flags.
- Strip a privilege designation from the log based on its own assessment. ❌ is a *recommendation* for the attorney, not an action against the log.
- Produce or withhold documents. It advises; the attorney decides; the attorney acts.
- Guarantee correctness on ✅ calls. The attorney is responsible for the log. This is a first pass.
- Access Westlaw, CoCounsel, CourtListener, Everlaw, iManage, or other legal research / document management platforms. It uses web_search and documents the attorney provides in the conversation.

---

## Next steps

After presenting the review, close with a short decision tree:

1. **Resolve the ⚠️ flags** — attorney works through each flagged entry and decides: keep, strip, or redact.
2. **Act on the ❌ recommendations** — attorney confirms which designations to remove before service.
3. **Address pattern problems** — if descriptions are under-detailed, redraft before serving.
4. **Citation check** — attorney verifies any `[web search — verify]` or `[model knowledge — verify]` tagged authorities against primary sources before relying on them.
5. **Service** — only after attorney sign-off on all flags and designations.
6. **Something else** — say what.
