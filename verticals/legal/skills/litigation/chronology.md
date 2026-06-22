---
slug: litigation.chronology
name: Litigation Chronology Builder
practice_area: litigation
description: Build or update a matter chronology from documents and uploads — dated events extracted, de-duplicated, privilege-flagged, and tagged by significance per the matter theory.
when_to_use: When the attorney asks to build a chronology or timeline, says "chron from the production" or "what happened when," or needs a working timeline, statement-of-facts skeleton, or witness-specific timeline.
user_invocable: true
---

# Litigation Chronology Builder

> **Every chronology produced by this skill is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns every legal conclusion, characterization, and significance call. Do not file, share outside the privilege circle, or rely on any output without attorney sign-off.**

---

## Disclosed-document use restrictions

Before working with a set of litigation documents, ask: "Were any of these documents obtained through disclosure or discovery in legal proceedings?" If yes:

- **US (Federal Rule 26(c) / protective orders):** Documents produced in discovery may be subject to a protective order. Check the order before using them in a different matter, sharing them outside counsel, or using them for any purpose beyond the proceeding in which they were produced.
- **England & Wales (CPR 31.22):** The implied undertaking restricts use to the proceedings in which the documents were disclosed unless the court permits or the disclosing party consents.
- **Other jurisdictions:** Similar restrictions commonly apply. Surface the question.

If the attorney has not confirmed the intended use is permitted, flag it: "⚠️ These documents may carry disclosure/protective-order use restrictions. Confirm this use is permitted before proceeding."

---

## Purpose

Facts happen in order. The chronology is the spine every narrative hangs on — the statement of facts in a brief, reserve memos, settlement memos, deposition prep, witness prep. This skill extracts dated events from documents the attorney provides, de-duplicates, privilege-flags, and tags each event by significance relative to the matter theory.

**Jurisdiction assumption:** default to North Carolina / US rules unless the attorney specifies otherwise. Surface this assumption at the top of every output.

---

## Modes

Two practice settings; the attorney can specify or you can infer from context:

- **Matter mode (default).** Matter-history-focused. Reads the matter and client in context, works from documents the attorney uploads or pastes in chat, and tags events for advocacy use. Output is matter-centric: what happened across the dispute.
- **Documents mode.** Production-document-focused. Works from an eDiscovery export, a Bates-numbered production, or a set of custodial files the attorney provides. Output is production-centric: what the documents show, with Bates citations if available, tagged per the case theory.

If neither is clear, default to matter mode and briefly note the assumption.

---

## Side framing (significance tags)

The same event is significant in different ways depending on whether you are proving a claim or defeating one. Ask the attorney which side's framing to apply if it is not clear from context:

- **Plaintiff / offensive framing** — 🔴 marks events that establish elements of the claim (liability, causation, damages, notice), close gaps the defense will try to open, or start statute-of-limitations clocks in the plaintiff's favor. 🟡 marks events that support the claim but are subject to impeachment. ⚪ is background context.
- **Defense / defensive framing** — 🔴 marks events that break elements of the claim (failure of causation, notice, reliance), open statute-of-limitations or jurisdictional defenses, or support affirmative defenses (release, waiver, assumption of risk, comparative fault). 🟡 marks events that undermine the plaintiff's narrative. ⚪ is background.

Note the applied framing at the top of every output: `Significance tags applied from [plaintiff / defense] perspective.`

---

## Load context

When the attorney invokes this skill:

1. **Matter/client in context** — if a matter or client is already in your context, ground the chronology in it. If not, ask: "Which matter should I build this chronology for?"
2. **Documents provided** — work from whatever the attorney uploads, pastes, or links in chat. If no documents are provided, ask.
3. **Case theory** — read from the matter context if present. If not stated, ask the attorney for the pivot fact and key facts before tagging significance, or build an untagged extraction pass and ask for theory confirmation before tagging.
4. **Firm positions** — apply any firm-stated positions or playbook provided in context. If a position is not given, use a conservative default and explicitly flag the assumption.

**You cannot access external eDiscovery platforms (Everlaw, Relativity, DISCO, Aurora), document management systems (iManage), or CLM systems directly.** If the attorney references one of these, ask them to export and upload the relevant documents, or to paste key text in chat. Use `web_search` only for public-record events (court dockets, regulatory filings, press releases) — always tag those results `[web search — verify]`.

---

## Workflow

### Step 0: Privilege gate (runs first, every time)

Chronology work pulls from documents that may be privileged — attorney-client, work product, common interest, or joint-defense. Extracting content from a privileged document into a chronology that later gets shared outside the privilege circle can risk waiver. Waiver analysis is fact-specific; get attorney sign-off before distributing.

Before extracting, ask the attorney to pick a privilege posture:

> Before I extract: how have the sources been privilege-screened?
>
> - **A. All sources cleared** — you've already screened these. I extract without privilege flags. Output is still marked work product.
>
> - **B. Mixed or not yet screened** — I extract and tag every entry with a privilege flag: `ok` (sourced from clearly non-privileged material), `flag` (sourced from potentially privileged material — attorney-client, work product, common interest), or `review` (source unclear). Flagged entries are visually marked in the output, and the Statement-of-Facts variant filters them out by default.
>
> - **C. Abort — screen first** — pause here. Screen the sources. Return and re-run.

Record the choice in the chronology header as `Privilege posture: A-cleared | B-mixed | C-aborted`. This is the provenance stamp for any later distribution call.

### Step 1: Identify document sources

Ask the attorney to provide documents or point you to them. Source types you can work from in chat:

- Uploaded PDFs, Word documents, text files, email exports
- Text or email content pasted directly in chat
- Web-searchable public-record events (court filings, regulatory actions, public press releases) — always tagged `[web search — verify]`

**If coverage looks thin for a key date range or custodian**, say so explicitly: "I have [N] documents covering [period]. Coverage looks thin. Are there additional sources you'd like to add before I build?" Do not fill gaps silently.

**No silent supplement.** If sources for a period are thin, report what was found and stop. Ask:

> "Sources returned [N] events for [period / custodian]. Coverage appears thin. Options: (1) upload or paste additional documents, (2) try a web search for public-record events in this window — results will be tagged `[web search — verify]` and should be verified before relying on them, or (3) stop here and note the gap. Which would you like?"

A lawyer decides whether to accept lower-confidence sources. You do not decide for them.

### Step 2: Extract events

For each document provided, identify dated events:

- **Email:** `[date] [sender] told [recipient] [subject/content summary]`
- **Meeting:** `[date] [attendees] met about [topic]` (per calendar entry or notes)
- **Decision:** `[date] [decision-maker] decided [what]` (per memorializing document)
- **Filing / pleading:** `[date] [party] filed [motion/complaint/response]`
- **External event:** `[date] [thing happened]` (contract signed, product launched, regulator acted, threshold crossed)

One event per document usually. Occasionally zero (undated or no event established). Sometimes multiple (meeting summary covering several decisions).

**Privilege flag per entry (only when privilege posture == B-mixed). Three-state rule:**

- `priv: ok` — source is **confidently** non-privileged (filings, regulatory correspondence, public documents, counterparty communications without your counsel). Used only when there is no plausible privilege theory.
- `priv: flag` — source is confidently or likely privileged (communications with counsel, work-product memos, privileged drafts, joint-defense material). **Default for anything uncertain.** If the dominant-purpose call is close, or litigation contemplation is borderline, or the content is mixed, it goes here — not in `ok`.
- `priv: review` — source unclear on its face (no sender/recipient metadata, unreadable, etc.).

When `priv: flag` or `priv: review`, add `[SME VERIFY: privilege status]` inline. Under-flagging waives privilege (one-way door); over-flagging is corrected by counsel in review (two-way door). Prefer the recoverable error.

**Source attribution — tag every entry.** For events extracted from a provided document: cite the document (file name, Bates number, or description). For any event or date that cannot be traced to a provided document: tag it inline — `[web search — verify]`, `[model knowledge — verify]`, or `[attorney provided]`. Entries tagged `verify` carry higher fabrication risk and should be checked first. Never strip the tags.

**Tagging reaches beyond timeline entries.** Any statement about a legal conclusion, deadline, computed date, statute-of-limitations window, tolling event, or privilege determination that is not sourced from a provided document must carry a provenance tag: `[computed from: <rule cited>]`, `[model knowledge — verify]`, `[attorney provided]`, or `[web search — verify]`. A statute-of-limitations window with no tag defaults to `[model knowledge — verify]`.

### Step 3: De-duplicate

The same event often surfaces in multiple documents: a meeting on three calendars and a summary email is **one event with four sources**, not four events. Merge them. The merged entry cites all sources.

### Step 4: Tag significance — per case theory

If the attorney has provided a pivot fact and key facts (from matter context or stated in chat), tag each event:

- 🔴 **Key** — event is part of the pivot fact or a key fact for/against the client
- 🟡 **Relevant** — context, pattern evidence, supports a secondary argument
- ⚪ **Background** — useful for completeness, not going in the brief

**Discipline:** a chronology of 300 entries with 300 🔴 tags has no tags. Reserve 🔴 for events that would genuinely move a factfinder. When in doubt, 🟡.

**Borderline tagging:** when an entry sits between 🔴 and 🟡 (or 🟡 and ⚪), tag at the lower significance and add `[SME VERIFY — borderline significance call]` inline. A chronology that surfaces its uncertainty is more useful than one that confidently over-tags.

### Step 5: Present in chat

Present the chronology in chat for the attorney to review. The attorney can then save it in the app, copy it to another tool, or request a variant (statement of facts, witness-specific). Do not assume any output is final until the attorney confirms.

If you previously built a chronology for this matter in this session, note what changed: new events added, entries modified (new sources), entries with altered significance tags.

---

## Output format

### Working chronology (default)

```
[WORK PRODUCT — ATTORNEY-CLIENT PRIVILEGED — DRAFT FOR REVIEW ONLY]
[North Carolina / US rules assumed unless stated otherwise]

# Chronology — [Matter Name]

> Significance tags (🔴/🟡/⚪) and privilege flags (🔒) are first-pass reads requiring [SME VERIFY] before use in any external work product (briefs, SoF, filings, outside-counsel deliverables).

Matter: [name or matter ID from context]
Mode: matter | documents
Built: [YYYY-MM-DD]
Sources: [N] documents / uploads across [source types described]
Entries: [N] ([N] 🔴 / [N] 🟡 / [N] ⚪)
Pivot fact: [one sentence, or "not provided — significance tags omitted"]
Side framing: [plaintiff / defense / not specified]
Privilege posture: A-cleared | B-mixed | C-aborted
Flagged entries: [N] 🔒  ← only present when posture == B-mixed

---

## Timeline

| Date | Event | Tag | 🔒 | Sources |
|---|---|---|---|---|
| [YYYY-MM-DD] | [what happened, one sentence] | 🔴/🟡/⚪ | [blank / 🔒-flag / 🔒-review] | [document name / Bates / [web search — verify]] |

---

## Key events (🔴 only)

### [date] — [event title]
- What: [one line]
- Theory tie: [why this matters to the case theory]
- Sources: [list]

---

## Gaps

**Date ranges with no events:**
[ranges — where are documents for this period?]

**Expected but missing:**
[events that would normally be documented but are not present in the sources provided — e.g., "contract amendments between 2024-06 and 2025-03 — not in provided documents"]

**Inaccessible sources:**
[sources the attorney mentioned but could not be reached this session — e.g., "Everlaw production — no connector; export and upload needed"]

---

## Marker discipline

- `[VERIFY: factual assertion — date, attendees, content]` — not yet confirmed against the underlying document
- `[UNCERTAIN: legal characterization — e.g., whether an event establishes a regulatory trigger]`
- `[CITE NEEDED: Bates / exhibit / depo page:line]`
- `[SME VERIFY: privilege status | borderline significance call]` — attorney judgment needed
- `[web search — verify]` — sourced from a web search; check against a primary source before relying
- `[model knowledge — verify]` — not sourced from a provided document; verify independently
```

---

### Statement-of-facts variant (on request)

Filter to 🔴 and relevant 🟡 only. Present as prose in chronological narrative order — the skeleton for a brief's fact section. Each paragraph covers one event or a tightly linked cluster, with record citations.

**Privilege filter default:** when privilege posture == B-mixed, 🔒-flagged and 🔒-review entries are **excluded** by default. The statement-of-facts skeleton is intended for eventual external use (briefs, disclosures, negotiating counterparty) — flagged entries should not appear there until the attorney confirms privilege status. If the attorney wants flagged entries included, they must say so explicitly; note the acknowledgment at the top of the output.

### Witness-specific variant (on request)

Filter to events where a named witness is sender, recipient, attendee, or subject. Feed witness preparation and help reconstruct what a witness knew and when.

---

## What this skill does not do

- **Resolve contradictions.** When two documents state different dates or facts about the same event, both entries go in with a `[VERIFY: conflicting sources]` flag. Resolution is the attorney's call; may require witness interview or further discovery.
- **Invent events not in the sources.** If a fact is not in the provided documents, not stated by the attorney, and not found by web search, it is not in the chronology — but the Gaps section will call it out.
- **Guarantee completeness.** The chronology is only as good as the sources provided. If only a subset of a production has been uploaded, the chronology reflects that — and the limitation is stated explicitly.
- **Decide privilege status.** The Step 0 gate forces the posture choice; the per-entry `priv` flag captures a first-pass classification. Actual privilege determinations are the attorney's call per `[SME VERIFY]` flags.
- **Access external platforms directly.** Everlaw, Relativity, DISCO, iManage, Westlaw, CoCounsel, CourtListener, DocuSign, and similar platforms are not directly accessible. Ask the attorney to export and provide the relevant documents, or use `web_search` for public-record events only.
