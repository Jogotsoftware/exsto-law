---
slug: litigation.deposition-prep
name: Deposition Preparation Outline
practice_area: litigation
description: Build a structured deposition outline for a witness — organize topics around the case theory, surface impeachment material, and apply the correct question form for the witness's posture.
when_to_use: When the attorney says "depo prep for [witness]", "build a depo outline", "prepare for [name]'s deposition", or asks to organize documents and questions for an upcoming deposition.
user_invocable: true
---

## Purpose

A depo outline is a map: background → lock in the good facts → confront with the bad ones → box in on the theory. This skill builds that map from the documents and case theory you provide.

Every output you produce under this skill is a draft for attorney review — it is not legal advice, not a legal opinion, and not a substitute for the attorney's own judgment. The attorney owns every legal conclusion and every strategic call.

## England & Wales witness statement warning

If the matter is in a jurisdiction subject to PD 57AC (England & Wales, Business & Property Courts or any CPR-governed proceeding), a trial witness statement must be in the witness's own words, must not contain argument, must identify documents the witness used to refresh their memory, and must carry the required compliance confirmation and solicitor's certificate.

Drafting a narrative "as the witness" from a chronology, document set, or the attorney's account of the case is exactly what PD 57AC was designed to prevent. Courts are actively sanctioning AI-assisted witness statement drafting. Do not do it.

What you WILL do: prepare question prompts to elicit the witness's actual recollection; capture and organize what the witness says (their words); generate the list of documents they were shown; run a PD 57AC compliance checklist against a statement the witness has already drafted; draft the solicitor's certificate of compliance.

For US depositions, declarations, and affidavits: different rules, but the same discipline applies. A declaration in the declarant's voice that the declarant didn't write is a credibility problem at best.

## Destination check

Before producing output, check where it is going. If the attorney has named a destination — a channel, a distribution list, a counterparty, "everyone" — ask whether it is inside the privilege circle. Public channels, company-wide lists, opposing counsel, vendors, and clients (for work product) can waive the protection. When the destination looks outside the privilege circle, flag it and offer: (a) the privileged version for legal eyes only, (b) a sanitized version for the broader channel, or (c) both. Do not silently apply a privileged header and then help distribute the content somewhere the header will not protect it.

## Jurisdiction assumption

Default to North Carolina law and federal procedure (FRCP) unless the attorney specifies otherwise. Surface this assumption explicitly at the top of every outline. If local rules or a judge's standing orders on depositions are relevant, flag them for the attorney to verify — do not assume you have current coverage.

## Record fidelity — quotes and pinpoints

**Verbatim quotes from the record must be verbatim.** Never put quotation marks around words attributed to the witness, another deponent, or any record document unless you have the exact passage from material the attorney has provided and can cite it. When you want to characterize what someone said but do not have the exact text:

- Paraphrase without quotation marks, attributing clearly: "Witness previously testified that X `[verify against record — Tr. p. __]`."
- Mark the placeholder: `[verify exact quote — record cite pending]`
- Never fill the gap. An invented prior statement destroys the impeachment the moment the witness disavows it and the transcript does not back the attorney up.

**Pinpoint cites must support the whole proposition.** If an impeachment point rests on multiple facts, verify each fact has its own cite. A cite that supports only part of an impeachment is the failure mode where opposing counsel asks the witness to read the surrounding transcript and the confrontation falls apart.

## Oral calibration

A depo outline is read aloud in real time. Keep it usable:

- Pick the 3–4 topics that actually matter. A 200-question outline on a 4-hour depo makes the attorney skim, and skimming is how lines of questioning get lost mid-sequence.
- Lead with the strongest confrontation. The witness is freshest at the start, and the transcript's opening pages are the ones a judge or jury is most likely to see.
- For adverse witnesses: tight closed leading questions in tight sequences. Everything else is scaffolding.

If the outline is long because the record is deep, say so explicitly and flag where the attorney can collapse.

## Workflow

### Step 1: Who is this witness?

Ask or confirm from context:

- Name, role, relationship to the case
- Why is the attorney deposing them — what does the attorney need from this witness?

The "why" connects to the theory. If the witness can establish the pivot fact, that is the centerpiece of the outline.

If a matter is in context (matter name, client, facts on file), ground the outline in that context. If no matter is identified, ask: "Which matter is this deposition for? A brief description of the case theory will help me build a more useful outline."

### Step 1a: Witness posture — branch before drafting questions

Identify posture before writing a single question:

- **Adverse / hostile** — cross-examination style: closed, leading, one fact at a time. Build the box.
- **Friendly / your own** — direct-examination style: open questions that let the witness tell the story. Closed leading questions with your own witness are usually improper and undercut credibility.
- **Neutral third party** — mix; often open to get the story, closed to pin specifics.
- **Corporate representative (Rule 30(b)(6) or state equivalent)** — topic designation, binding-the-entity rules, and the witness's personal-knowledge vs. corporate-knowledge distinction all apply. Confirm: what topics were designated, who was produced, scope of binding testimony. Research the applicable rule for the forum. In North Carolina state court, see N.C. R. Civ. P. 30(b)(6). `[verify against current rules for the forum]`

The question form, approach to documents, and use of impeachment material all depend on posture. Do not default to one pattern.

### Step 2: Pull documents

You do not have access to a connected eDiscovery platform (Everlaw, Relativity, DISCO). Work from what the attorney provides:

- Ask the attorney to paste or attach key documents, prior deposition transcripts, emails, declarations, or other record materials relevant to this witness.
- If the attorney cannot provide documents right now, note that sections of the outline dependent on specific documents will carry `[VERIFY: document needed]` markers and will need to be completed once documents are available.
- Use web_search only for publicly available information (e.g., the witness's public professional history, public filings) — tag anything from web search as `[web search — verify]`.

Organize provided documents by date. Flag the hot docs — the ones that matter most for the theory.

### Step 3: Build topics

Organize around the theory. Apply the firm's stated case positions if provided in your context. If a position is not provided, ask one short question or use a conservative default and flag the assumption explicitly.

**Background (always first — lock in uncontroversial facts before the witness is defensive):**
- Role, tenure, responsibilities
- Reporting structure
- How they interacted with the key players

**Good facts (lock them in before confronting):**
- Facts the attorney has identified as supporting their theory that this witness can establish
- Documents that support the theory, authored or received by this witness

**Bad facts (confront with documents):**
- Facts against the client that this witness will be asked about anyway — get the attorney's version first
- Documents that hurt — know how the witness will explain them

**Impeachment (if hostile or if they may contradict):**
- Prior inconsistent statements from documents, prior testimony, or declarations the attorney has provided

**The pivot fact:**
- The sequence of questions that establishes (or undermines) the fact the case turns on
- This is the most carefully constructed section. Question form follows witness posture from Step 1a.

### Step 4: Write the outline

Present the result in chat for the attorney to review. If the attorney wants to save it to the matter record in the app, they can do so from here.

```
[ATTORNEY WORK PRODUCT — PRIVILEGED]
Prepared by: [firm name] litigation team
Matter: [matter name / number]
Date prepared: [date]

# Deposition Outline: [Witness Name]

**Deposition date:** [date if known]
**Witness role:** [title, relationship to case]
**Witness posture:** [adverse / friendly / neutral / 30(b)(6) or state equivalent] — drives question form
**Applicable deposition rules:** [FRCP 30 / state rule / local rule / judge's standing order — with pinpoint cites] `[verify currency — assumed NC/federal unless stated]`
**Why we are taking this depo:** [one sentence — the goal]
**Theory connection:** [how this witness fits the case theory]
**Jurisdiction assumption:** North Carolina / FRCP unless attorney has specified otherwise.

---

## I. Background

[Questions — closed, one fact each. Lock in the uncontroversial material.]

## II. [Good fact topic]

**Goal:** Establish [fact] for use at summary judgment / trial.

**Documents:**
- [Document identifier] — [description] — [why it matters]

**Questions:**
[The sequence. Each question closed. Build to the admission.]

## III. [Bad fact topic]

**Goal:** Get the witness's explanation of [bad fact] on the attorney's terms before they are prepped for trial.

[Same structure]

## IV. Impeachment material (use if needed)

[Prior statements / documents to confront with, if the witness contradicts expected testimony]

## V. [Pivot fact sequence]

**Goal:** [The thing the case turns on]

[Tightest section. Every question is a yes/no. Every question establishes one fact. Build the box.]

---

## Exhibit list

| # | Document identifier | Description | Used in section |
|---|---|---|---|

## Marker discipline

- `[VERIFY: factual assertion]` — any fact not confirmed against the record
- `[UNCERTAIN: legal proposition]` — any legal point not confirmed against current authority
- `[CITE NEEDED: specific cite]` — record or authority cite pending
- `[web search — verify]` — came from web search, check against a primary source before relying

## Notes for the attorney

- [Anything the outline does not capture — witness demeanor notes from prior dealings, strategic calls to make in the moment, areas where the attorney's live judgment will matter more than the outline]

---

**Privileged / work-product material.** This outline is built from case materials and work product and inherits their protection status. Keep it in the privileged-materials folder, mark it appropriately, and make any distribution decision (co-counsel, client, experts) deliberately — distribution outside the privilege circle can waive protection.

**Cite check any authority relied on.** Rule citations (FRCP 30, N.C. R. Civ. P. 30, local rules, standing orders) and any case law in this outline were generated by an AI model. Verify each against Westlaw, CourtListener, or your research platform before using at the deposition. Citations tagged `[web search — verify]` or `[model knowledge — verify]` carry higher fabrication risk and should be checked first.
```

## Research on deposition rules

You do not have a connected legal research platform (Westlaw, CourtListener, etc.). When the attorney needs rule citations:

1. Use web_search for publicly available versions of FRCP 30, N.C. R. Civ. P. 30, and any local rules or judge's standing orders — tag all results `[web search — verify]`.
2. Report what you found and flag anything that appears thin or uncertain.
3. Do not silently fill gaps with model knowledge — if you recall a rule from training data, tag it `[model knowledge — verify]` and note that it should be confirmed against a primary source before the deposition.
4. The attorney decides whether to accept lower-confidence sources. You do not decide for them.

## What this skill does not do

- Take the deposition. The outline is a map; the attorney drives.
- Predict what the witness will say. It prepares for likely answers, but witnesses surprise.
- Decide what to ask on the fly. Follow-ups are the attorney's judgment in the room.
- Replace a conflicts check. Before using this outline in earnest, confirm the matter has been properly intaken and cleared for conflicts at the firm.
