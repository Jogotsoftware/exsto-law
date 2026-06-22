---
slug: corporate.diligence-issue-extraction
name: Due Diligence Issue Extraction
practice_area: corporate
description: Review deal documents provided by the attorney and extract issues by category and materiality, producing findings in a structured memo format ready for attorney review.
when_to_use: When the attorney asks to review data room documents, extract diligence issues, review a deal folder, or asks "what's in the VDR" or similar — or pastes/attaches deal documents for issue spotting.
user_invocable: true
---

## Purpose

Help the attorney cut through a large document set and surface the issues that actually matter for the deal. You read the documents the attorney provides (or pastes) against standard diligence categories and materiality thresholds, extract issues, and present findings in a structured memo format for attorney review and decision.

All output is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns every legal conclusion and the decision about what to do with each finding.

## Before you begin

- **Matter context.** If a matter or client is loaded in context, ground your analysis in it. If not, ask which deal or matter this is for so you can label findings correctly.
- **Documents.** You work from documents the attorney pastes into chat, attaches, or describes. You do not have access to a VDR (virtual data room) platform directly. If the attorney references a VDR folder, ask them to paste or summarize the relevant documents, or tell you which categories they want to work through first.
- **Firm positions and materiality thresholds.** If the attorney has stated deal-specific thresholds (e.g., "only flag contracts over $500K") or firm positions on specific issues, apply them. If a threshold is not stated, ask one short question — e.g., "What's the materiality cutoff for contract value?" — or use a conservative default and flag the assumption explicitly.
- **Jurisdiction.** Default to North Carolina law and U.S. federal law where jurisdiction is relevant and none is stated. Surface that assumption; redirect if the deal is in a different jurisdiction.

## Step 1: Inventory what you have

Before extracting issues, map what the attorney has provided to the standard diligence request list categories. Note gaps — categories with no documents yet.

```
## Document Inventory: [Deal name / matter]

| Category | Documents provided | Status |
|---|---|---|
| Corporate & Organizational | [list] | Reviewed / Pending |
| Material Contracts | [list] | Reviewed / Pending |
| Intellectual Property | [list] | Reviewed / Pending |
| Employment & Benefits | [list] | Reviewed / Pending |
| Litigation & Regulatory | [list] | Reviewed / Pending |
| Real Estate & Assets | [list] | Reviewed / Pending |
| Financial & Tax | [list] | Reviewed / Pending |

**Gaps (no documents yet):** [categories with nothing to review]
```

Ask the attorney if they want to proceed with what is available or pause to gather more documents for any gap category.

## Step 2: Apply the materiality filter

Before reading every document, apply the threshold:
- For contracts: if a value threshold was given, focus on contracts above it; note how many were set aside below threshold.
- For litigation: flag all pending matters regardless of size; flagged-but-below-threshold matters go in an appendix.
- When in doubt, flag and let the attorney decide — under-flagging is a one-way door.

## Step 3: Extract issues by category

For each document reviewed, check against the standard issue set for its category:

### Material Contracts
- Change of control provision — is consent required? From whom? Is this deal a triggering event?
- Assignment restriction — can the contract transfer to the buyer?
- Exclusivity / non-compete — does it restrict the buyer's existing or planned business?
- Most favored nation (MFN) pricing — does it constrain the combined entity's pricing?
- Termination rights — can the counterparty walk because of this deal?
- Unusual indemnities or uncapped liability exposure

### Corporate & Organizational
- Cap table accuracy; outstanding options, warrants, convertible notes
- Board and stockholder consent requirements for the transaction
- Stockholder agreement restrictions (drag-along, tag-along, right of first refusal)
- Subsidiary structure and intercompany arrangements; cross-default risk

### Intellectual Property
- Ownership chain — are founder/employee assignment agreements in place?
- Open source in the product — copyleft licenses (GPL, AGPL) that could affect product distribution
- Key IP licensed vs. owned — can licenses be assigned or do they terminate on change of control?
- Pending or threatened IP litigation or third-party claims

### Employment & Benefits
- Change-of-control severance triggers — parachute cost, Section 280G exposure
- Key employee retention risk
- Pending or threatened employment litigation
- Worker classification risk — contractors who function as employees

### Litigation & Regulatory
- Pending matters and any disclosed reserves
- Threatened claims (demand letters, regulatory inquiries)
- Regulatory approvals required to close (HSR, sector-specific)
- Pattern litigation (consumer class actions, environmental)
- **Successor liability** — even in asset deals, flag: pending tort/products-liability claims; environmental cleanup obligations; bulk-sale or fraudulent-transfer exposure (is seller retaining enough to pay its remaining creditors?); seller's post-closing dissolution plan; whether the assumed/excluded-liabilities schedule covers known exposures. The "de facto merger," "mere continuation," and "product line" doctrines can transfer liability in asset deals — this is the analysis that surprises buy-side clients who think they bought assets clean.

## Step 4: State each finding

Use this template for every issue:

```
Issue #N: [Short title]
Category: [request list category]
Severity: 🔴 Red | 🟡 Yellow | 🟢 Green
Documents: [document name / identifier provided by attorney]
Finding: [What the document says and why it matters for the deal]
Recommendation: [price adjustment / indemnity / consent required / rep & warranty / walk / flag for outside counsel]
```

**Severity calibration:**
- 🔴 **Red — affects deal value or structure.** Change of control requiring major customer consent. Undisclosed material litigation. IP ownership gap on core product.
- 🟡 **Yellow — needs attention, solvable.** Consent required but likely obtainable. Open source requiring remediation. Employment classification risk.
- 🟢 **Green — noted for file.** Consistent with reps. No action needed beyond the rep.

**Source attribution for legal citations.** When a finding references a statute, regulation, case, or doctrine:
- Tag citations from documents the attorney provided as `[attorney-provided]`.
- Tag citations from web search as `[web search — verify]`.
- Tag citations from your training knowledge as `[model knowledge — verify]`.
- Never strip or collapse tags. Citations tagged `verify` should be checked against a primary source before relying on them in a deal memo or advice letter.
- **If a document or deal-team note cites a statute for a proposition you do not believe is accurate, do not invent a description of what the statute says.** Say instead: "That section doesn't match what I'd expect [requirement] to say — I'd need to pull the actual text to characterize it accurately. `[statute unretrieved — verify]`" Then either ask the attorney to paste the text, use web_search to find it and quote it directly, or flag for outside counsel. A confident wrong description of a real statute is worse than "I don't know."
- **If a web_search returns thin or no results for a legal basis a finding needs, report what was found and stop.** Say: "Search returned [N] results and coverage is thin for [rule / doctrine]. Options: (1) broaden the search query, (2) flag as unverified and note for outside counsel, (3) continue with a `[model knowledge — verify]` tag. Which would you like?" The attorney decides whether to accept lower-confidence sources.

## Step 5: Assemble findings by category

Group findings by category, sorted by severity within each category.

```
> PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION / ATTORNEY WORK PRODUCT
> This output is derived from materials that may be privileged, confidential, or both.
> It inherits the source's privilege and confidentiality status. Do not distribute
> beyond the privilege circle without deliberate review. Store with the matter's
> privileged files.

# Diligence Issues: [Deal name] — [Category]

**Documents reviewed:** [N]
**Coverage:** [All | Above $X threshold | Categories provided]
**Findings:** [N]🔴  [N]🟡  [N]🟢

---

### Bottom line

[The one thing the deal team needs to know right now]

---

[Each issue in the template above]

---

## Gaps

- [Category or document type with no responsive material provided]
- [Document referenced in another document but not provided]
```

## Handoffs and closing checklist

Any finding that implies a discrete pre-closing action should be flagged explicitly so it can become a checklist item. This includes:
- **Third-party consents** (change of control, anti-assignment)
- **Shareholder vote or corporate approval** (§280G cleansing vote, required board resolutions, stockholder consents, appraisal-rights notice periods)
- **Regulatory filings and approvals** (HSR, CFIUS, sector-specific)
- **Releases, terminations, payoff letters, lien releases**
- **Escrow or holdback mechanics** tied to a specific issue

When surfacing these, ask the attorney: "Should I add these to a closing checklist?" and present them in a separate closing-checklist section if yes.

## Large document sets

If the attorney provides a large set of contracts, process in batches by category. After each batch, surface any 🔴 issues immediately — do not wait for the full category to finish before flagging a deal-affecting issue.

## Offer a dashboard for large extractions

If the extraction produces more than ~10 issues, or if the attorney asks, offer a summary dashboard:

```
## Issue Dashboard: [Deal name]

| # | Title | Category | Severity | Closing action? |
|---|---|---|---|---|
| 1 | ... | ... | 🔴 | Yes |
| ... | | | | |

Totals: [N]🔴  [N]🟡  [N]🟢
```

## After presenting findings — next steps

Close with a short decision tree:

> **Next steps — your call:**
> 1. Draft a diligence memo or issues list for the deal team
> 2. Escalate a specific 🔴 finding to outside counsel
> 3. Send a supplemental document request for gaps
> 4. Mark specific items as accepted risk and move to closing checklist
> 5. Something else — just tell me

## What this skill does not do

- It does not make materiality calls on close cases — it applies the threshold; the attorney decides the borderline.
- It does not negotiate reps and warranties — it produces the findings that inform them.
- It does not replace specialized bulk AI contract review platforms. For high-volume clause extraction, those tools are better suited; this skill handles the judgment layer — nuanced documents, side letters, amendments, and anything that needs legal interpretation.
- It does not have direct access to VDR platforms, Westlaw, Lexis, or legal research databases. Use web_search for publicly available sources and note the verification requirement; the attorney should verify citations against primary sources before relying on them in advice.
