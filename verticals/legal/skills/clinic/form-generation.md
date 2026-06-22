---
slug: clinic.form-generation
name: Legal Clinic First-Draft Document Generation
practice_area: clinic
description: Produce a first draft of a common clinic document (eviction answer, asylum application narrative, protective order petition, demand letter, etc.) from the matter facts in context, with inline flags for missing facts and items requiring attorney verification.
when_to_use: When the attorney asks for a first draft of a court document, petition, motion, letter, or form; when a matter is active and a document needs to be started from case facts; or when the attorney names a document type and wants a structured starting point.
user_invocable: true
---

# Legal Clinic First-Draft Document Generation

## Purpose

A first draft is scaffolding, not a conclusion. This skill produces the starting structure from the matter facts in context so the attorney's time goes to analysis, strategy, and edits — not to formatting a caption or writing the opening paragraph.

**Every draft produced by this skill is explicitly a starting point, not final work product.** It is not legal advice. It does not constitute a legal opinion. Every `[VERIFY]` and `[FACT NEEDED]` flag must be resolved before the document is filed, sent, or signed. The attorney owns the legal conclusion and the final document.

> **Jurisdiction assumption:** This skill defaults to North Carolina courts and North Carolina substantive law when no jurisdiction is specified. Caption format, service rules, page limits, filing deadlines, and controlling authority vary materially across jurisdictions and between courts in the same state. If the matter is in another state or a different North Carolina court from the one assumed, surface that and confirm the correct rules apply before relying on any format, deadline, or argument in the draft.

---

## Working with Matter Context

If a matter and client are already in context (injected by the app), ground the draft in those facts. If no matter is in context, ask: "Which matter should I draft for, and do you have intake notes or case facts to share?"

Apply the firm's stated positions or drafting preferences if they appear in your context. If a relevant position is not given, use a conservative default and flag the assumption explicitly.

---

## Step 1 — Match the Document Type

Match the request to the document type. Common types for a North Carolina business-law or general clinic practice:

| Practice area | Documents |
|---|---|
| **Housing / Eviction** | Answer to summary ejectment complaint, demand letter (repairs / security deposit), motion to stay execution of judgment |
| **Immigration** | I-589 asylum application client narrative, client declaration, motion to change venue, FOIA request, country conditions summary |
| **Family / Protective Orders** | DVPO petition (50B), custody declaration, motion to modify, financial affidavit |
| **Consumer / Debt** | Debt validation letter, FDCPA demand letter, answer to collection complaint, motion to vacate default judgment |
| **Business / Contracts** | Demand letter, notice of breach, simple cease-and-desist letter |
| **General Litigation** | Motion template, notice of appearance, certificate of service, discovery requests |

If the requested document type is not in the list above: "I can attempt a draft from general principles, but I'll flag it heavily — this document type doesn't have a verified template in the default set. Confirm that this approach is appropriate before relying on any structure or language in the draft."

---

## Step 2 — Gather the Facts

Review the matter facts provided. For each fact the document requires, note whether it is present or missing:

| Document requires | Present? | Source |
|---|---|---|
| [fact] | Yes / No | [intake notes / uploaded doc / need to obtain] |

Do not guess at missing facts. Mark them explicitly:

`[FACT NEEDED: client's date of entry — obtain from I-94 or ask client]`

If critical facts (party names, dates, the claim itself) are absent, ask for them before drafting rather than producing a shell with too many gaps to be useful.

---

## Step 3 — Apply Jurisdiction Rules

Default to North Carolina General Statutes and the North Carolina Rules of Civil Procedure unless the matter specifies otherwise.

- **Caption format:** Follow North Carolina General Court of Justice caption format unless local rules for the specific court differ. Flag if local rules are unknown: `[VERIFY CAPTION: confirm against current local rules for [Court]]`
- **Service requirements:** Flag the method and deadline required by N.C.R. Civ. P. or the relevant statute. Mark if the matter's court has different standing orders.
- **Local quirks:** Page limits, font/margin requirements, mandatory cover sheets, and filing fees vary. Flag anything not confirmed from the case materials: `[VERIFY: confirm [Court]'s current standing orders on page limits]`

If the matter is in federal court, flag that the Federal Rules of Civil Procedure apply and that caption format, service rules, and filing procedures differ materially from state court.

---

## Step 4 — Draft

Produce the document in the appropriate format for the document type and jurisdiction. Fill every field that can be filled from the provided facts. Leave placeholders explicit — never substitute plausible-sounding invented language for a fact that is missing.

**Everywhere the draft makes a legal assertion** — that a claim is valid, that a defense applies, that a deadline has not run, that a statute requires X — treat it as a hypothesis the attorney verifies, not a guaranteed conclusion. Mark accordingly with `[VERIFY]`.

Use plain language at the register appropriate for the document type (formal for court filings; plain and direct for demand letters to lay recipients).

---

## Step 5 — Inline Flags

Three flag types, used inline throughout the draft:

- `[FACT NEEDED: ...]` — the document needs a fact the provided materials do not supply
- `[VERIFY: ...]` — a legal or factual assertion that requires attorney research or confirmation before the document is used
- `[UNCERTAIN: ...]` — the skill is genuinely unsure and is saying so rather than guessing

Never suppress a flag to make the draft look more complete. A flag is more useful than false confidence.

---

## Step 6 — Supervision Gate

**Court filings and documents sent to opposing parties or clients have legal consequences.** Treat every output of this skill as requiring attorney review and sign-off before it leaves the firm.

The attorney reviews the full draft, resolves every flag, makes the strategic call on legal theory, and decides whether the document is ready. The draft is not ready to file or send because it exists.

If the matter involves a filing deadline, flag it: "This matter may have an active filing deadline — confirm the deadline before relying on this draft."

---

## Output Format

Present the draft in chat using the following structure:

```
═══════════════════════════════════════════════════════════════════════
  AI-ASSISTED DRAFT — REQUIRES ATTORNEY REVIEW
  Starting point only. Every [VERIFY] and [FACT NEEDED] flag must be
  resolved before this document is filed, sent, or signed.
═══════════════════════════════════════════════════════════════════════

[The document — jurisdiction-aware format, flags inline]

═══════════════════════════════════════════════════════════════════════

## Attorney review checklist

Before this document leaves the firm:

- [ ] Read the complete draft. Does it say what you intend?
- [ ] Every fact: verified against the client's actual documents, not just intake notes
- [ ] Every [VERIFY] flag: resolved through research or struck
- [ ] Every [FACT NEEDED] flag: filled with verified information or the section removed
- [ ] Legal theory: is this the right argument? Are there better ones for this client's situation?
- [ ] Jurisdiction: caption, service, format, and deadline confirmed against current court rules
- [ ] If a filing deadline applies: confirmed and calendared
- [ ] Attorney review and sign-off complete before filing, sending, or sharing with client as final

## What this draft does not do

- It does not decide strategy. The draft uses the standard approach for this document type — the attorney decides whether that is right for this client.
- It does not verify its own legal assertions. Every legal conclusion in the draft is a hypothesis until the attorney confirms it.
- It does not file itself. The attorney reviews and authorizes every filing.
- It does not replace jurisdiction-specific research. Local rules, recent case law, and standing orders require attorney verification.
```

After presenting the draft, remind the attorney: "Save this to the matter record in the app if you'd like to keep a working copy."

---

## What This Skill Does Not Do

- **Produce final work product.** First draft only. The attorney revises and approves.
- **Guess at missing facts.** Flags them for the attorney to obtain.
- **Decide the legal theory.** Uses the common approach; the attorney decides if it fits this client and this matter.
- **Access external legal databases.** This chatbot does not have a live connection to Westlaw, Lexis, or similar services. For case law and statutory verification, use web_search and any materials the attorney provides — and note the limits of that approach for critical research.
- **Access court filing systems.** The attorney files through the appropriate portal or clerk's office.
- **Replace attorney judgment.** The attorney owns the legal conclusion, the strategy, and every decision about what leaves the firm.

---

## Jurisdiction and Ethics

Default jurisdiction is North Carolina. Surface this assumption in the draft header if the matter has not specified a court.

North Carolina RPC 1.1 (competence) and RPC 5.3 (supervision of nonlawyer assistance) apply to AI-assisted drafting. The attorney is responsible for the competence of the final work product regardless of how the first draft was generated.

*ABA Formal Opinion 512 (2024): generative AI use in legal practice requires competence, supervision, and verification. This draft is designed to be supervised and verified — it is not designed to be relied upon without that.*

> All outputs are drafts for attorney review. The attorney is responsible for accuracy, legal conclusions, and any action taken based on this document.
