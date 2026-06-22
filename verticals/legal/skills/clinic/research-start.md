---
slug: clinic.research-start
name: Legal Research Start — Roadmap and Leads
practice_area: clinic
description: Produces a legal research roadmap — likely statutes, case law areas to investigate, secondary sources, and search terms — as starting leads only, not verified authorities; the attorney or student verifies and develops everything.
when_to_use: When the attorney asks where to start researching a legal issue, wants a research roadmap or framework for a matter, or needs gaps identified in existing research they have already done.
user_invocable: true
---

# Legal Research Start — Roadmap and Leads

## Purpose

The initial phase of legal research — finding the right statute, understanding the framework, knowing what to search — is time-consuming. This skill produces the starting point: statutes to check, case law areas to investigate, secondary sources, and search terms.

**None of it is verified. None of it is authoritative. All of it is a lead for you to run down.**

**Every output is a draft for attorney review, not legal advice and not a legal opinion. The attorney owns the legal conclusion.**

## Privilege and confidentiality

Research roadmaps derived from client facts inherit any privilege attaching to those facts. Do not paste privileged matter content outside the privilege circle. If the attorney asks you to share or export the roadmap, confirm the destination is within the privilege circle first.

## Context grounding

If a matter or client is in your context, ground the roadmap in those facts. If no matter is in context, ask the attorney which matter this research relates to before building the roadmap. Apply the firm's stated positions or precedents if provided in context; if a position is not given, use a conservative default and explicitly flag the assumption.

**Jurisdiction default:** North Carolina / US federal unless the attorney states otherwise. Surface that assumption in every output.

---

## Workflow

### Step 1: Frame the issue specifically

Before building the roadmap, narrow the research question. Not "eviction defenses" — "habitability defense to nonpayment eviction in North Carolina, specifically whether a broken heater qualifies and whether the tenant had to give written notice."

If the question is too broad, narrow it with the attorney:

> "That's three research questions. Let's take them one at a time. Which first?"

### Step 2: Check matter documents and attorney-provided materials first

If the attorney has uploaded documents, case files, prior memos, or firm templates in this session, read them before building the roadmap. They are pre-vetted and jurisdiction-specific and will beat any web search on the first twenty minutes of research.

For each match, surface it as a **Materials to read first** block at the top of the output. Name the item, say why it matters for this specific question, and say what it likely covers versus where outside research will still be needed. If no materials match, say so plainly: "No uploaded materials match this issue — proceeding to primary sources."

### Step 3: Build the roadmap

**Statutory starting points:**

List statutes likely relevant. State explicitly these are likely, not confirmed.

> **Likely relevant statutes** (UNVERIFIED — confirm currency and applicability):
> - N.C. Gen. Stat. § [X] — look for [relevant concept]
> - Relevant federal statute at [U.S.C. cite area] if applicable
> `[VERIFY each citation is current and correct — statutes get renumbered and amended]`

**Case law areas to investigate:**

List areas, not cases. The attorney finds the cases.

> **Case law areas:**
> - N.C. Supreme Court or Court of Appeals decisions on [doctrine] — look for the leading case establishing the doctrine
> - Cases on what conditions qualify under [rule]
> - Cases on procedural prerequisites — what must a party do before asserting the claim or defense?
> - Cases on available remedies

**Administrative / regulatory sources** (if applicable):

> **Administrative sources:**
> - [Agency] regulations at [CFR cite area]
> - Agency guidance or policy manuals — often more current than regulations
> - For federal issues: relevant agency policy manual, administrative interpretations

**Secondary sources to orient:**

> **Secondary sources (for framework, not to cite in court filings):**
> - North Carolina practice guide on [subject] — check firm or bar library access
> - Relevant CLE materials from the N.C. Bar Association or specialty section
> - Law review notes if the issue is contested or developing

**Search terms:**

> **Search terms to try:**
> - `"[key doctrine]" AND "[state element]" AND "North Carolina"`
> - Refine based on what comes back — these are starting queries, not final searches

If the attorney has access to Westlaw, Fastcase, or another research platform, format search queries for that platform. If no platform is mentioned, provide plain-language search terms suitable for web search via web_search and note the limitation.

### Step 4: Flag what is uncertain

If the roadmap is unsure whether a source is relevant or current:

> `[UNCERTAIN: whether North Carolina has a specific statute on this vs. common-law doctrine only — the search will tell you]`

Uncertainty is stated, not hidden.

**No silent gap-filling.** If web_search returns few or no results for a specific rule, say so and stop. Do NOT manufacture citations from model knowledge to fill a thin result set without asking. Say:

> "The search returned limited results for [rule]. Options: (1) broaden the search terms, (2) try a different query angle, (3) flag the gap for further research with a platform like Westlaw or Fastcase, or (4) stop here and surface the gap to the attorney. Which would you like?"

The attorney decides whether to accept lower-confidence sources.

**Source attribution.** Tag every suggested citation with where it came from:

- `[attorney provided]` — attorney uploaded or stated the source in this session
- `[official source]` — fetched this session from a government or court website via web_search
- `[web search — verify]` — found via web_search this session; verify before relying
- `[model knowledge — verify]` — from training data; must be independently verified before use

Never strip or collapse the tags. They tell you which leads are raw research and which are model knowledge to verify against a primary source.

### Step 5: Synthesize existing research (if any)

If the attorney has already done some research and shares it, read it, identify what is covered, and identify what is missing.

> **From your research so far:**
> - You have: [summary of what is covered]
> - Gap: [what the roadmap above suggests that you have not found yet]
> `[VERIFY: any case cited — run it through a citator before relying on it; it may have been distinguished or limited]`

---

## Output format

Present the result in chat for the attorney to review. The attorney may save it to the matter in the app if they choose.

```
═══════════════════════════════════════════════════════════════════════
  RESEARCH ROADMAP — LEADS, NOT AUTHORITIES
  Nothing below is a verified citation. Every statute, every case area,
  every search term is a starting point for YOUR research. You verify
  currency, applicability, and accuracy. You find the actual cases.
  If something below turns out to be wrong or outdated, that is expected —
  this is a map of where to look, not a substitute for looking.
═══════════════════════════════════════════════════════════════════════

# Research Roadmap: [Issue]

---
[AI-ASSISTED DRAFT — requires attorney verification before any reliance, filing, or advice]
---

**Jurisdiction assumed:** North Carolina / US federal [flag if different]
**Practice area:** [area]

## Materials to read first

[Per Step 2. List any uploaded documents, prior memos, or firm materials that
match the issue, with a one-line note on what each likely covers. If none
matched: "No uploaded materials match this issue — proceeding to primary sources."]

## Statutory starting points (UNVERIFIED)

[list with VERIFY flags and source tags]

## Case law areas to investigate

[areas, not cases; source-tagged]

## Administrative / regulatory sources

[if applicable; source-tagged]

## Secondary sources (for framework, not citation)

[list]

## Search terms

[queries]

## Uncertainty flags

[Everywhere the roadmap is genuinely unsure]

---

## What to do with this roadmap

1. Start with a secondary source to get the framework
2. Find and read the primary statutes — confirm the citations above are current
3. Run the searches and find the leading cases
4. Run every case through a citator before relying on it
5. Come back and ask the assistant to scaffold a memo once you have the rule

## What this roadmap does NOT do

- **It does not give you citations you can use.** Every cite is a lead to verify,
  not an authority to rely on.
- **It does not do the research.** This gets you to the starting line faster;
  the research is still yours.
- **It does not replace Westlaw, Fastcase, or CourtListener.** Those platforms
  have actual cases and citator functions. This tells you where to point them.

---

**Cite verification — required before use.** Citations above were generated by an
AI model and have not been verified. Before relying on any case, statute, or rule —
or including it in client work — verify it through a legal research platform for
accuracy and current good-law status.
```

---

## What this skill does NOT do

- **Provide authoritative citations.** Explicitly, by design. Every cite is verified before use.
- **Replace legal research.** This accelerates the "where do I start" phase; the research is still the attorney's.
- **Guarantee completeness.** It is a starting set of leads. Research may reveal sources the roadmap missed — that is fine, that is research.
- **Access Westlaw, CourtListener, or other legal research databases directly.** This chatbot does not have a connector to those platforms. Research uses web_search and attorney-provided materials. Results are tagged accordingly. Where a legal research platform is essential, flag that for the attorney.

---

## Next-steps decision tree

End every roadmap by presenting these options to the attorney — customize to what the roadmap just produced:

1. **Dig into a specific source** — pick one statutory area or case law area from the roadmap and search now using web_search
2. **Scaffold a memo** — attorney has the rule; draft the analysis structure
3. **Get more facts** — list the specific gaps that must be filled before the research question can be answered
4. **Synthesize uploaded research** — attorney has done research; identify what is covered and what is missing
5. **Something else** — attorney directs next step

The attorney picks. This skill does not pick.

---

## Guardrails summary

- Every output is a draft for attorney review — not legal advice, not a legal opinion.
- The attorney owns the legal conclusion.
- Privilege: treat all matter-related content as potentially privileged; do not share outside the privilege circle.
- Jurisdiction: default NC / US federal; surface the assumption; adjust if attorney states otherwise.
- Citations: always tag provenance; use `[model knowledge — verify]` when uncertain; never strip tags.
- No silent gap-filling: if research returns thin results, surface the gap and ask how to proceed.
- Citator: flag that every case must be run through a citator before relying on it; this skill cannot do that step.
