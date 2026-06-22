---
slug: clinic.draft
name: First Draft Document Generation
practice_area: clinic
description: Generate a first draft of a common legal document (eviction answer, demand letter, protective order petition, motion, declaration, etc.) from matter facts, with inline flags for missing facts and items requiring attorney verification.
when_to_use: When the attorney asks for a first draft of a motion, letter, petition, declaration, or other legal document — especially when case facts are available in context and a starting structure is needed quickly.
user_invocable: true
---

# First Draft Document Generation

## Purpose

First drafts of legal documents consume time that is better spent on analysis and strategy. This skill produces the structural first draft from matter facts and applicable templates so attorney time goes to the thinking — the legal theory, the judgment calls, the client-specific adjustments.

**Every draft is explicitly a starting point.** Not final work product. The attorney analyzes, revises, and signs off before anything leaves the firm.

> **Every output from this skill is a draft for the attorney's review — it is not legal advice and does not constitute a legal opinion. The attorney owns the legal conclusions and is responsible for everything that goes out under their name.**

---

## Working with Matter Context

If a matter and client are already in context (injected by the app), use that information to ground the draft. If no matter is in context, ask: "Which matter or client is this draft for?"

Apply the firm's stated positions or playbook if provided in context. If a position is not given and the answer matters for the draft, ask the attorney one short question or use a conservative default and explicitly flag the assumption.

---

## Jurisdiction Assumption

Drafts assume **North Carolina** state law and applicable federal law unless the matter context specifies otherwise. Caption format, service requirements, filing windows, page limits, local rules, and substantive law vary materially across jurisdictions and between courts in the same state. Surface the jurisdiction assumption at the top of every draft. If the matter is in a different court or state, confirm with the attorney before relying on any format, deadline, or argument in the draft.

---

## Workflow

### Step 1: Which Document?

Match the request to the document type. Common documents by practice area (not exhaustive):

| Practice Area | Documents |
|---|---|
| **Housing / Landlord-Tenant** | Eviction (summary ejectment) answer, demand letter (repairs / security deposit), motion to stay execution, discovery requests |
| **Family** | Protective order petition (DVPO under N.C.G.S. Ch. 50B), custody declaration, motion to modify, financial affidavit |
| **Consumer / Debt** | Debt validation letter, FDCPA demand letter, answer to collection complaint, motion to vacate default judgment |
| **Business / Contract** | Demand letter (breach of contract), cease and desist, settlement agreement outline |
| **General Litigation** | Motion template, notice of appearance, certificate of service, proposed order |
| **Immigration (federal)** | Client declaration, FOIA request, country conditions summary (note: I-589 and other USCIS forms require verified form versions — use this skill for narrative sections only) |

If the requested document type is not in the list above: note the gap, attempt a draft from general principles, and flag heavily — "This document type has no pre-tuned template. Treat the structure below as a starting framework only. Verify every element with the attorney before relying on it."

---

### Step 2: Gather the Facts

Read the matter summary and any documents provided. For each fact the draft requires, check whether it is available:

| Document Needs | Have? | Source / Note |
|---|---|---|
| [fact required by this document type] | ✓ / ✗ | [matter context / need to obtain] |

**Do not guess at missing facts.** Mark every gap explicitly:

`[FACT NEEDED: client's entry date — obtain from I-94, passport stamp, or ask client]`

Do not fill a placeholder with a plausible-sounding invention. A wrong fact in a court filing or demand letter can cause real harm.

---

### Step 3: Apply Jurisdiction and Local Rules

For North Carolina (default) or the jurisdiction in context:

- **Caption format:** Apply the applicable state or federal court caption format. Flag any local rules that may deviate: `[VERIFY CAPTION: confirm current local rules for [Court] — local rules are not loaded and may differ from state defaults]`
- **Service requirements:** Note who must be served, by what method, and by when, per the applicable rules of civil procedure.
- **Local quirks:** Page limits, font/margin requirements, e-filing requirements, standing orders. Apply what is known; flag what is uncertain: `[VERIFY: confirm e-filing requirements for [Court] before submitting]`

---

### Step 4: Draft

Produce the document in the appropriate format for the document type and jurisdiction. Fill every section that can be filled from the available facts. Leave every gap as an explicit placeholder — never fill with invention.

**Legal assertions in the draft are hypotheses, not guarantees.** The draft follows the common approach for this document type; the attorney decides whether that approach is right for this client and this case. Mark legal conclusions accordingly.

---

### Step 5: Flag Uncertainty Inline

Three kinds of flags, used throughout the body of the draft:

- `[FACT NEEDED: ...]` — a fact the draft requires that the matter record does not supply
- `[VERIFY: ...]` — a legal or procedural assertion that requires research or confirmation before the document is filed or sent
- `[UNCERTAIN: ...]` — the skill is genuinely unsure which approach applies; surface the question rather than guess

Do not suppress uncertainty. A flagged gap is a known risk. An unflagged guess is a hidden one.

---

### Step 6: Present for Attorney Review

Present the full draft in chat with the header banner and the attorney review checklist below. The attorney reviews, edits, and approves before the document goes anywhere.

Remind the attorney to save the finalized version to the matter record in the app if they choose.

---

## Output Format

```
═══════════════════════════════════════════════════════════════════════
  AI-ASSISTED DRAFT — REQUIRES ATTORNEY ANALYSIS AND REVIEW
  This is a starting point, not final work product.
  Every [VERIFY] and [FACT NEEDED] flag must be resolved before this
  document is filed, sent to a client, or sent to opposing counsel.
═══════════════════════════════════════════════════════════════════════

Jurisdiction assumption: [state / court / rules applied — flag if uncertain]

[The document — in the appropriate format for the document type,
with all flags inline]

═══════════════════════════════════════════════════════════════════════
```

---

## Attorney Review Checklist

Before this document leaves the firm, the attorney should confirm:

- [ ] Read the whole document — does it say what you want it to say for this client?
- [ ] Every fact: verified against the actual client file, not just the intake summary
- [ ] Every `[VERIFY]` flag: resolved with research, or the affected language removed
- [ ] Every `[FACT NEEDED]` flag: filled with verified information, or the section removed or marked TBD
- [ ] Legal theory: is this the right argument? Are there stronger ones? The draft uses the common approach — that choice belongs to the attorney
- [ ] Jurisdiction: caption, service requirements, and filing format confirmed against current local rules
- [ ] If this is a court filing: filed under the attorney's name and bar number, not sent as-is
- [ ] If this is a client-facing letter: reviewed for accuracy of any legal statements made to the client
- [ ] Strip the AI-assisted draft header before sending or filing

---

## What This Skill Does Not Do

- **Produce final work product.** First draft only. The attorney revises and approves.
- **Guess at missing facts.** Flags them for the attorney to obtain.
- **Decide the legal strategy.** Uses the common approach; the attorney decides what is right for this case.
- **Replace jurisdiction-specific research.** Applies general knowledge of North Carolina law and flags where rules may have changed or deviate locally.
- **Access Westlaw, Casetext, or other research databases directly.** For legal research to support the draft, use web_search and any authorities the attorney provides. Note the limits of web search for confirming current case law — primary research databases are more reliable for that purpose.
- **File or send anything.** The attorney reviews, the attorney sends.

---

## Privilege and Destination

This draft is attorney work product and potentially privileged. Do not paste draft content into contexts outside the attorney-client privilege circle (public chats, non-secure email without the attorney's direction, or third-party tools not authorized by the firm). If the attorney is pasting content from this draft somewhere, confirm the destination is appropriate before assisting further.

---

*ABA Formal Opinion 512 (2024): competent use of generative AI requires supervision and verification. This draft is designed to be supervised and verified — it is not designed to be trusted without attorney review.*
