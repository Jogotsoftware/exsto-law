---
slug: regulatory.reg-feed-watcher
name: Regulatory Feed Watcher
practice_area: regulatory
description: On-demand regulatory update scan — pull recent agency activity, classify by materiality, surface deadlines, and route action items to the attorney.
when_to_use: When the attorney asks "what's new from [agency]," "check the regulatory feeds," "any regulatory updates since [date]," or manually pastes a regulatory item for classification and triage.
user_invocable: true
---

## Purpose

Pull recent regulatory activity for the agencies and topics the attorney cares about. Filter by materiality. Report what's left. The filter is the value — unfiltered feeds are noise.

This skill runs on demand in chat. Because this is a web assistant rather than a scheduled agent, it does not run automatically on a cron. When you want a regulatory digest, ask for one and specify the agencies, topics, or date window you care about.

---

## Before you start — what do you want watched?

To run a useful check, establish:

1. **Which agencies / regulators** — e.g., FTC, SEC, CFPB, NC DOJ, NCDOL, EDPB, state AGs.
2. **Topic filter** — the subject areas that are material to this practice or client (e.g., "consumer protection, data privacy, business formation").
3. **Date window** — since a specific date, or "last 30 days" if not specified.
4. **Materiality threshold** — what tier of activity warrants a detailed entry vs. an FYI vs. skip (see classification table below). If not given, use the default tiers and flag the assumption.

If a matter or client is in context, ground the topic filter in what you know about that matter. Otherwise ask the attorney one short question about the practice areas or agencies to watch before proceeding.

**Assumption flags:** Whenever you apply an unstated assumption (e.g., "I defaulted to US federal agencies + North Carolina because no jurisdiction was specified"), say so explicitly in the digest header. The attorney can correct the scope and re-run.

---

## Step 1 — Pull

Use web_search to gather recent regulatory activity from:

- **Federal Register** (`federalregister.gov`) — search by agency name and date range. Returns document type, title, abstract, effective date, and comment deadlines for NPRMs.
- **Agency news / press-release pages** — most agencies publish RSS or "news" pages; use web_search targeting `site:<agency>.gov` for recency.
- **regulations.gov** — for docket activity, comment periods, and NPRM filings.
- **NC-specific:** NC Register and Office of State Budget and Management (ncleg.gov / osbm.nc.gov) for state rulemakings. NC DOJ and NC Secretary of State sites for enforcement and guidance.
- **Documents the attorney provides** — any pasted text, uploaded notice, or linked document is treated as a single item; skip the web_search pull and go straight to Step 2.

**No silent gap-filling.** If search returns thin results for a requested regulator, say so and offer options: (1) broaden the date window, (2) try a different search angle, (3) stop here. Do not substitute model training knowledge for live results without flagging it.

**Source attribution.** Tag every item with its source:

- `[Federal Register]` — retrieved from federalregister.gov
- `[<Agency> site]` — retrieved from agency website
- `[regulations.gov]` — retrieved from the docket system
- `[web search — verify]` — surfaced via general web search; check against the issuing authority's site before relying
- `[model knowledge — verify]` — surfaced from training data; high fabrication risk, confirm against primary source
- `[user provided]` — pasted or uploaded by the attorney

Do not strip or collapse these tags. Items marked `verify` should be confirmed against the primary source before any client advice or action.

**Secondary sources** (IAPP, Covington, Hogan Lovells, JD Supra, Lexology, and similar commentator/aggregator sites): tag with `[secondary source]` in addition to the feed tag. Add a note: "→ Trace to primary: confirm on [agency].gov before relying." Do not classify a secondary-source item as "Always material" on its own — hold it at Review-worthy until the primary source is confirmed.

**Jurisdiction default:** US federal + North Carolina unless the attorney specifies otherwise. Surface this assumption explicitly.

---

## Step 2 — Classify

Assign each item a materiality tier:

| Item type | Default tier |
|---|---|
| Final rule | Always material |
| Proposed rule / NPRM | Review-worthy — always log comment deadline |
| ANPR (Advance Notice of Proposed Rulemaking) | Review-worthy for strategy only — no compliance obligation yet; log comment deadline |
| RFI (Request for Information) | Same as ANPR — direction-signaling, comment deadline is real |
| Enforcement action — sector match | Material |
| Enforcement action — related-practice match | Review-worthy |
| Enforcement action — no match | FYI or skip |
| Guidance | Review-worthy |
| Speech / blog / agency statement | FYI or skip |
| Settlement — novel theory or large penalty | Review-worthy |
| Settlement — routine | Skip |

**ANPR / RFI handling.** Pre-rule items do not impose compliance obligations. Classify as review-worthy only if the issue areas touch the attorney's always-material categories. Always include in the digest: "Pre-rule. Comment deadline [date] if any. No compliance gap yet — monitor for NPRM."

**NPRM comment deadlines.** For every NPRM classified above "skip," extract the comment deadline and include it prominently. Flag if the deadline is within 14 days.

**If the attorney has stated materiality preferences in context** (e.g., "anything touching data privacy is always material for this client"), apply them. If no preferences are given, use the default tiers above and say so.

---

## Step 3 — Enrich

For each item at Review-worthy or Always-material tier:

- One-line summary of what changed or what was proposed
- Relevance hook — why this might matter for this practice or matter
- Effective date or comment deadline
- Source link

For FYI items: list title + link only, no summary. Count them in the header.

---

## Output format

Present the digest in chat. If the attorney wants to save it, they can copy it into the matter record in the app.

```
## Regulatory Feed Check — [date]

**Period:** [date range checked]
**Sources searched:** [list — e.g., Federal Register, FTC site, regulations.gov, web search]
**Scope:** [agencies / topics / jurisdiction — flag any assumptions]
**Items found:** [N] total

### Bottom line

[N item(s) need attention by [date]. Top items: X, Y.]

---

### Always material

**[Regulator] — [Title]** [source tag]
[One-line summary]. [Relevance hook]. Effective [date].
[Link]
→ Recommended next step: [e.g., review against client's data-handling practices; consider running a policy gap check]

[repeat]

---

### Review-worthy

**[Regulator] — [Title]** [source tag]
[One-line summary]. [Relevance]. [Deadline if any].
[Link]
[For NPRMs: "Comment deadline: [date] — decision needed by [date minus 5 business days]"]
[For ANPRs/RFIs: "Pre-rule. Comment deadline [date] if any. No compliance gap yet."]

[repeat]

---

### FYI

[N] items — titles and links only, no summaries:
- [Title] ([source tag]) — [link]
- ...

---

**Jurisdiction assumed:** [US federal + North Carolina / other — flag if inferred]
**Materiality threshold:** [default / attorney-specified]
**Next check:** [suggest date or "ask me when you want another scan"]
```

---

## What to do with results

After presenting the digest, offer a short next-steps menu — customize to what the digest actually found:

- **Always-material item found:** "Want me to run a policy gap check against [affected policy or practice area]?"
- **NPRM with upcoming deadline:** "Want me to open the comment-period tracker for [rulemaking] and record a filing decision?"
- **Enforcement action:** "Want me to summarize the theory and flag exposure for [client/matter]?"
- **Nothing above FYI:** "All quiet. [N] FYI items, nothing needing action."
- **Something else:** "What would you like to do next?"

The attorney picks. Do not proceed with any of the above without an explicit go-ahead.

---

## Limits — state these when relevant

- This assistant does not have access to Westlaw, Bloomberg Law, CourtListener, or dedicated regulatory monitoring services. Research relies on web_search and documents the attorney provides. Results may be incomplete, especially for smaller state agencies or recent items not yet indexed by search.
- For comprehensive real-time monitoring, maintain a docket-alert subscription (e.g., regulations.gov alerts, agency email lists) in parallel with this assistant.
- `[model knowledge — verify]` items carry elevated fabrication risk. Always confirm these against the primary source before client advice.

---

## Guardrails

- Every output is a draft for attorney review, not legal advice and not a legal opinion.
- The attorney owns the legal conclusion — including whether a rule applies to a given client, what the compliance gap is, and what action to take.
- Do not produce client-facing advice, submission-ready drafts, or filed documents past this gate without an explicit go-ahead from the attorney.
- Jurisdiction is always surfaced. When no jurisdiction is specified, default to US federal + North Carolina and flag it. Do not silently apply a different jurisdiction.
- Conservative defaults on materiality. When in doubt between two tiers, assign the higher one and ask.
- Privilege check: if the attorney pastes internal client communications or privileged analysis, treat that content as attorney-client privileged and do not include it in any output intended to leave the privilege circle (e.g., a comment letter, a client-facing memo). Flag if the destination of a draft output is unclear.
