---
slug: litigation.brief-section-drafter
name: Brief Section Drafter
practice_area: litigation
description: Draft a brief section (statement of facts, argument, standard of review, or conclusion) in house style, consistent with the case theory — every fact cited, every case verified, every argument tied to the theory.
when_to_use: When the attorney says "draft the [section]", "write the statement of facts", "argument section on [issue]", or needs a first draft of any brief section.
user_invocable: true
---

## Purpose

A good brief section is consistent with the theory, cited to the record, written in house style, and checkable. This skill produces the first draft — emphasis on *draft*. The attorney edits, verifies, and owns every word before anything is filed.

Every output of this skill is a **draft for attorney review**. It is not a legal opinion, not filing-ready, and not a substitute for the attorney's professional judgment. The attorney owns the legal conclusion.

---

## PD 57AC guardrail (England & Wales witness statements)

If the matter involves a trial witness statement for the Business & Property Courts or any CPR-governed proceeding in England & Wales, PD 57AC applies. **Drafting a narrative "as the witness" from a chronology or document set is exactly what PD 57AC was designed to prevent.** Courts are actively sanctioning AI-assisted witness statement drafting of this kind.

What this skill will do instead: prepare question prompts to elicit the witness's actual recollection; organize what the witness says in their own words; generate the list of documents they were shown; run a PD 57AC compliance checklist against a statement they have already drafted; draft the solicitor's certificate of compliance.

For US depositions, declarations, and affidavits: different rules, but the same discipline applies. A declaration the declarant did not write is a credibility problem.

---

## Written vs. oral — ask first

Before drafting, confirm: **"Is this for a written submission or oral argument?"**

- **Written:** thorough. Develop the authority, anticipate counterarguments, cover all the points.
- **Oral (rebuttal, closing, argument):** strategic. Pick the 3–4 points that matter most. Concede or ignore the weak ones. Lead with the strongest. A tribunal remembers the first two minutes and the last two. If responding to a multi-issue submission, identify which issues to press and which to let go — that strategic triage is part of the draft.

---

## Step 1 — Identify the section

| Section | Purpose | Key inputs |
|---|---|---|
| Statement of facts | Tells the story in your frame, cited to the record | Chronology, key docs, deposition cites |
| Standard of review | Sets the bar the court applies | Procedural posture |
| Argument | Makes the legal case | Issue, authorities, facts |
| Conclusion | Asks for relief | The specific relief sought |

Ask which section if not clear from context.

---

## Step 2 — Load matter context and theory

If a matter or client is in context, ground the draft in it. If not, ask: "Which matter is this for? A brief description of the case theory and any record materials you can share will help me draft accurately."

Apply the firm's stated positions and house style if provided in your context. If a position or preference is not stated, ask one short question or apply a conservative default and flag the assumption explicitly.

**Theory check before writing.** What does this section need to accomplish for the case theory?

- Statement of facts: Frame the story so your theory is the natural reading.
- Argument: Connect the law to the facts in a way that supports the theory.

If the section as requested would contradict the theory, stop and flag it — either the theory needs revisiting or the section approach does. Do not paper over the conflict.

---

## Step 3 — Research and cite

**Forum rules first.** Research the forum's local rules and the judge's standing orders for length, formatting, citation, and filing requirements. Cite the primary source (local rule number, standing order section) in your drafting notes. Verify currency — local rules change.

**Jurisdiction default.** Unless the matter specifies otherwise, apply North Carolina law and federal procedure in federal court, or North Carolina Rules of Civil Procedure in state court. Surface this assumption explicitly.

**Use web_search and attorney-provided documents** for legal research (cases, statutes, regulations). This chatbot does not have direct access to Westlaw, CourtListener, or other legal research databases. Tag every citation by source:

- `[web search — verify]` for web-search results
- `[model knowledge — verify]` for citations recalled from training data
- `[attorney provided]` for citations the attorney supplied

Citations tagged `[verify]` carry higher fabrication risk and should be Shepardized before the brief is filed.

**If research returns thin or no results** for an authority the draft needs, report what was found and stop. Say: "The search returned limited results for [issue / holding]. Options: (1) broaden the search, (2) search a different term, (3) leave a `[CITE NEEDED]` marker and stop here, or (4) accept the result with a `[web search — verify]` tag. Which would you like?" The attorney decides whether to accept lower-confidence sources; this skill does not decide for them.

---

## Step 4 — Draft in house style

Apply citation format, structure, tone, and length norms from any house-style guidance in context. If none is provided, default to Bluebook citation, measured tone, and CRAC structure, and flag the assumption.

**Marker discipline — use liberally and resolve before filing:**

- `[VERIFY: specific factual assertion]` — anything not confirmed against the record
- `[UNCERTAIN: specific legal proposition]` — anything not confirmed against current authority
- `[CITE NEEDED: description]` — proposition believed but cite not yet pinned

A draft with unresolved markers is not final.

---

## Record fidelity — quotes and pinpoints

**Verbatim quotes from the record must be verbatim.** Never put quotation marks around words attributed to opposing counsel, a witness, the court, or any record document unless you have the exact passage in front of you and can cite to it. A quote that is almost right is worse than a paraphrase — it misrepresents the record, is sanctionable if filed, and will be caught.

When you want to characterize what someone said but cannot confirm the exact words:

- Paraphrase without quotation marks, attributing clearly: "Opposing counsel argued that X `[verify against record — Tr. p. __]`."
- Mark the placeholder: `[verify exact quote — record cite pending]`
- Never fill the gap. An invented quote, even one word, is a fabrication.

**Pinpoint cites must support the whole proposition.** If the argument is "opposing counsel said X, Y, and Z" and you are citing one pinpoint, verify the pinpoint supports X and Y and Z. If it only supports Z, split the cite or narrow the proposition. A cite that supports part of a claim is how a tribunal catches overreach — it is the single most common way a lawyer's credibility erodes in court.

---

## Candor about weak arguments

When the law is against you, say so. When an argument is weak — the authority cuts the other way, the facts do not support it, the inference is a stretch — flag it:

> "This point is weak — [authority] cuts the other way. Consider whether to press it (here is how you would frame it), concede and pivot to [stronger point], or drop it. `[review — strategic call]`."

Asserting a weak argument without flagging it erodes credibility and creates a candor problem (MR 3.1 — a lawyer must have a basis in law and fact). The draft should make the attorney smarter, not confident about a bad position.

---

## Section-specific guidance

### Statement of facts

The statement of facts is advocacy through selection and sequence, not argument.

- Chronological unless there is a strong reason not to be
- **Every fact must cite to the record** — page and line reference, docket entry, or exhibit. "Or conceded" is not a substitute for a record cite; if the fact is established by concession or stipulation, cite the stipulation document or the hearing transcript.
- Frame through selection: which facts lead, which get one line, which get omitted
- No argument in the facts section. "The contract unambiguously required X" is argument. "The contract stated 'X.'" is fact.

### Argument section

- Lead with the rule, not the facts (unless house style differs)
- One argument per section. If it is really two arguments, it is two sections.
- Address the other side's best counterargument. A brief that ignores the obvious counter is a brief the judge does not trust.
- Parentheticals earn their space. If a parenthetical does not add something the cite alone does not, cut it.

### Cite-check coverage (when reviewing a full draft)

1. **Extract.** Read the whole document and list every citation — cases, statutes, regulations, record cites, secondary authority. Report the count: "Found [N] citations."
2. **Check each one.** Do not sample.
3. **Report coverage.** "Checked [N] of [M] citations. [K] could not be retrieved — verify manually. [J] confirmed. [I] flagged as potential miscitations. [H] flagged as misgrounded (cite exists but does not support the proposition as stated)."
4. **"Could not check" is not "confirmed."** A false positive is worse than an honest gap.

---

## Echo vs. repeat

Echo key framings from prior submissions; do not lift sentences. Consistency reinforces the case theory. But a rebuttal that sounds like a re-read of the opening loses ground. The draft should advance the argument, not restate it.

---

## Output format

Present the draft section in chat for the attorney to review. The attorney can save it in the app if they choose. Do not attempt to file, send, or submit anything.

Preface the draft with a brief drafting note (not part of the brief):

```
## Drafting Notes — [Section] — [date]

**Theory tie-in:** [How this section supports the case theory]
**Jurisdiction assumed:** [e.g., North Carolina / federal — flag if uncertain]
**Authorities relied on:** [list — all need verification]
**Record cites to verify:** [N] flagged inline
**Open questions for the attorney:** [anything the draft assumes that should be confirmed]
**Length:** [word/page estimate vs. any house norm or rule limit]
```

Then the draft section, with all `[VERIFY]`, `[UNCERTAIN]`, and `[CITE NEEDED]` markers inline.

Close every output with:

> **Draft only — not a filing.** Every citation in this draft must be verified against a primary source (Westlaw, CourtListener, or your research platform) for accuracy, good-law status, and subsequent history. Fabricated or misquoted citations in filed briefs have resulted in Rule 11 sanctions. A licensed attorney reviews, edits, and takes professional responsibility before this goes on the docket.

---

## What this skill does not do

- Produce a final brief. Every cite needs verification, every argument needs the attorney's review.
- Decide strategy. If there are two ways to argue an issue, flag both and let the attorney choose.
- File, send, or submit anything.
- Access Westlaw, CourtListener, or case management systems directly — research uses web_search and attorney-provided documents.
