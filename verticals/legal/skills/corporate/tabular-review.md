---
slug: corporate.tabular-review
name: Tabular Contract Review
practice_area: corporate
description: Build a structured review grid from a batch of contracts — one row per document, one column per extracted data point, every cell cited to the exact source text.
when_to_use: Attorney says "tabular review", "review grid", "build a grid", "extract these fields from these contracts", "give me a spreadsheet of", "batch review", or points at multiple documents and asks to compare them on a defined set of questions.
user_invocable: true
---

## Purpose

You have a pile of documents and a list of questions you need answered consistently across every one. A diligence request list. A vendor contract audit. A lease portfolio review. The output is a table: document rows, data-point columns, and every cell traceable to the exact words in the source.

This is not issue spotting — that task finds the 30 problems hiding in 2,000 documents. This skill answers the same 15 questions about all 2,000 documents. Both are legitimate; they answer different questions.

This is also not a replacement for reading the document. Every cell this skill produces is a **lead that needs attorney verification**, not a finding. The output is designed to make verification fast, not to skip it.

**Every output is a draft for attorney review. This is not legal advice and does not constitute a legal opinion. The attorney owns the legal conclusion.**

---

## Step 0: Confirm what and where

Before doing anything, confirm:

1. **Documents.** Which documents should be reviewed? The attorney may paste text, upload files, or describe what they have. How many? If more than ~20, the review will take longer — offer to start with a higher-priority subset.
2. **Schema.** What columns are needed? Two paths:
   - Attorney describes the questions in plain language → you structure them into the typed schema below.
   - Attorney has done this before and provides a prior schema → reuse and adjust.
3. **Matter context.** If a matter or client is in context, ground all output in it. If not, ask which matter this is for before beginning.

---

## The column type system

Every column has a **type** that constrains the answer format. Types hold; free text drifts.

| Type | What it returns | Use for |
|---|---|---|
| `verbatim` | Exact quote from the document, character-for-character | Defined terms, operative clause language, anything where the exact words matter |
| `classify` | One value from a fixed list you define | Yes/No, present/absent, clause variants (e.g., "sole consent" / "consent not unreasonably withheld" / "silent") |
| `date` | ISO date | Effective date, expiration, termination notice deadline |
| `duration` | Number + unit | Term length, notice period, survival period |
| `currency` | Number + currency code | Caps, thresholds, fees, purchase price references |
| `number` | Bare number | Counts, percentages, page references |
| `free` | Short free-text summary | Use sparingly — only when the above types genuinely don't fit |

**The verbatim rule.** Every non-`verbatim` column also captures the exact source quote that supports the answer. The answer in the cell is the interpretation; the quote is the evidence. A `classify` cell that says "consent not unreasonably withheld" is useless without the sentence it came from, because the attorney's job is to check whether that's the right read.

---

## The three states of "not found"

A blank cell hides information. Use one of three explicit states whenever you cannot produce a positive answer:

| State | Meaning | When to use |
|---|---|---|
| `not_present` | The document was read and the clause is not there | You are confident the subject matter is not addressed |
| `unclear` | Something is there but you cannot classify it confidently | Ambiguous drafting, partial clause, conflicting provisions |
| `needs_review` | You found something but a human must make the call | Edge case, unusual drafting, the answer depends on a judgment the schema does not capture |

These are three different pieces of information. A deal team handles "the contract is silent on assignment" very differently from "the assignment clause is ambiguous." Collapsing them into a blank cell loses the distinction.

**North Carolina / US law is assumed unless the document specifies otherwise.** Surface this assumption explicitly in the summary.

---

## Step 1: Build and confirm the schema

Turn the attorney's column list into a structured schema. For each column: a stable `id`, a human `label`, a `type`, a `prompt` (the question a reviewer reading the document would ask), and for `classify` columns an `options` list.

Show the schema to the attorney and confirm before reviewing any documents. Example schema for M&A diligence:

```
Schema: M&A Diligence Review

Columns:
- counterparty [verbatim] — Who is the contracting party other than the target?
- effective_date [date] — When did the agreement become effective?
- change_of_control [classify: silent | consent_required | consent_not_unreasonably_withheld | automatic_termination | notice_only] — Does the agreement address a change of control of the target?
- assignment [classify: silent | consent_required | consent_not_unreasonably_withheld | freely_assignable | assignable_to_affiliates] — Can the target assign this agreement?
- term_length [duration] — What is the initial term?
- auto_renewal [classify: yes | no | silent] — Does the agreement auto-renew?
- termination_for_convenience [classify: yes_either_party | yes_counterparty_only | yes_target_only | no | silent] — Can either party terminate for convenience?
- notice_period [duration] — What advance notice is required for termination?
- liability_cap [currency] — What is the aggregate liability cap?
- governing_law [classify: NC | other_US | international] — What law governs?
```

**Firm positions.** If the attorney has provided diligence thresholds, playbook positions, or materiality standards in the conversation context, apply them. If a relevant position is not given, use a conservative default and flag the assumption explicitly — do not invent firm-specific positions as authoritative.

---

## Step 2: Sample run

Do not review all documents on an untested schema. Run 3–5 documents first. Show the attorney the rows and look for:

- Columns where most answers are `unclear` — the prompt is ambiguous; rewrite it.
- `classify` columns where answers do not fit the defined options — add options or switch to `free`.
- `verbatim` columns returning paraphrases — reinforce that the quote must be character-for-character.

Adjust the schema, re-run the sample, and confirm before proceeding.

---

## Step 3: Review each document

For each document, work through every column:

1. Read the entire document provided (not a partial excerpt — the whole thing).
2. For each column, find the relevant provision.
3. For each cell, return: `value` (the typed answer, or null), `state` (`answered | not_present | unclear | needs_review`), `quote` (verbatim supporting text), and `location` (section number, heading, or page reference).

**The quote is not optional, and the verbatim rule is mechanical, not aspirational.** Before marking a cell `answered`:

- The `quote` MUST be a character-for-character copy of contiguous text from the source document. Do NOT paraphrase and call it verbatim. Do NOT reconstruct a quote from memory of how such clauses "usually" read. Do NOT stitch together non-contiguous text with ellipsis to compose a quote.
- The `location` must be specific enough for the attorney to re-open the document and find the same span — a section number, heading, or page reference.
- If you cannot locate and copy the exact text (document truncated, provision implied but not written, OCR unreadable), set state to `needs_review`, value to null, and note `quote_unavailable: <reason>`. It is never acceptable to mark a cell `answered` with a composed or reconstructed quote.
- The same verbatim obligation applies to companion source quotes attached to `classify`, `date`, `duration`, `currency`, `number`, and `free` cells.

A cell with `state: answered` and a mismatched or composed quote is a higher-severity failure than `unclear` or `needs_review` — it misrepresents the evidence trail. When in doubt, downgrade to `needs_review`.

Every document in the set gets a row. A document that cannot be read gets a row of `needs_review` with a note explaining why.

---

## Step 4: Normalize across documents

After reviewing all documents, read the whole table column by column to catch inconsistent interpretation — the primary failure mode of any batch review.

For each `classify` column:
- Check that every `answered` value is in the defined options list. Outliers get re-classified or bumped to `needs_review`.
- Check for suspicious clusters: if 19 of 20 documents say `consent_required` and 1 says `freely_assignable`, look at that 1 — is it genuinely different, or a misclassification?

For each `date` / `duration` / `currency` column:
- Normalize format.
- Flag implausible values (a 99-year term, a $1 cap) as `needs_review`.

For each `verbatim` column and all companion source quotes:
- Spot-check by re-reading the source document at the cited location and comparing the stored quote character-for-character. Sample at least 3–5 rows per column or 10%, whichever is larger.
- If any quote is composed, paraphrased, or cannot be located at the cited span: downgrade that cell to `needs_review` with `quote_mismatch` in notes, and widen the spot-check for that column — one fabricated quote is reason to check the rest.

---

## Step 5: Present the output

Present the review table in the chat for the attorney to review. Use this markdown structure:

```markdown
| Document | Counterparty | Effective Date | Change of Control | Assignment | Flags |
|---|---|---|---|---|---|
| Vendor MSA — Acme Corp | Acme Corp | 2023-04-01 | consent_required | consent_required | — |
| Supply Agmt — Beta LLC | Beta LLC | 2021-11-15 | unclear | silent | CoC ambiguous §14.2 |
```

Then provide a companion sources table (or inline notes) with the verbatim quotes and locations for each cell, so the attorney can verify without hunting through the original document.

Include this distribution notice at the top of every output:

> This review is derived from source documents that may be privileged, confidential, or both. It inherits the sources' privilege and confidentiality status — distribution beyond the privilege circle can waive privilege. Store with the matter's privileged files and make distribution decisions deliberately.

If the attorney wants to save or export the table, they can copy from the chat into their matter folder, spreadsheet, or document management system. Note that a CSV or Excel export is not something this assistant produces as a file — present it in chat and offer to reformat if needed.

---

## Step 6: Summary

After the table, provide a one-screen summary:

- Document count, column count, rows completed.
- Count of `not_present`, `unclear`, `needs_review` per column — this is the verification workload.
- Any columns where more than 10% of rows were flagged in the normalization pass.
- Jurisdiction assumption used (default: North Carolina / US).
- A reminder: **every cell is a lead, not a finding. Attorney verification is required before this table informs a representation, a disclosure schedule, a closing memo, or any advice to a client.**

---

## Next steps

End with a short decision tree tailored to what was just produced. Default branches:

1. **Draft a memo or summary** of the flagged items for the client or deal team.
2. **Dig deeper on a specific document** — run a closer read or issue-spotting pass on any contract with multiple flags.
3. **Expand the schema** — add a column and re-run against documents already reviewed.
4. **Add more documents** to the same schema.
5. **Something else** — ask.

---

## What this skill does not do

- **It does not replace reading the documents.** It tells the attorney where to look.
- **It does not produce confidence scores.** The `unclear` / `needs_review` states and the verbatim quotes are the confidence signal — if the quote does not support the value, flag it.
- **It does not silently skip documents.** Every document in the set gets a row. A document that could not be read gets a row of `needs_review` with a note.
- **It does not pretend a paraphrase is a quote.** The evidence trail is the whole point.
- **It does not access external legal databases.** Where a legal research question arises (e.g., whether a particular clause type is enforceable in NC), use web_search and note that the result has not been validated against primary sources — the attorney must verify before relying on it.
- **It does not produce a legal opinion.** The attorney owns the legal conclusion.

---

## Relationship to other skills

- **Issue spotting** finds problems; this extracts data points. If an extraction reveals a potential issue (a MAC clause tied to specific financials, an unusual termination trigger), note it and suggest a focused issue-spotting pass on that document.
- **Material contract schedule** builds one specific table (a disclosure schedule). It can consume this skill's output directly — the schedule is a filtered, reformatted view of a tabular review.
- For very large corpora (hundreds of contracts) or when the firm uses a dedicated contract review platform (Kira, Luminance, etc.), this in-chat review covers what can be handled here; larger batches may need to be broken into sessions or handed off to a dedicated tool.
