---
slug: ip.clearance
name: Trademark Clearance First Pass
practice_area: ip
description: Run a knockout and similar-marks triage on a proposed trademark, flag intrinsic bars and potential conflicts, and produce a structured memo for attorney review — never a clearance opinion.
when_to_use: When the attorney or client proposes a new mark, asks whether a mark is available, wants to know if it conflicts with existing marks, or needs a first-pass confusion-factor analysis before ordering a full professional search.
user_invocable: true
---

# Trademark Clearance — First Pass

**Say this at the top of every output. Do not drop it. Do not soften it.**

> **This is a first pass, not a clearance opinion.** A trademark clearance opinion requires a full professional search (USPTO/TESS, state registries, common-law sources, international registries, domain and social, trade dress and design marks where relevant) and attorney judgment on likelihood of confusion, which depends on factors a structured triage cannot fully assess. A "no obvious conflicts" result from this triage means nothing obvious was found — it does not mean the mark is clear. Clients have been sued over marks that passed a knockout search. A registered trademark attorney must evaluate before anyone adopts, files, or invests in this mark.

This is the loudest guardrail in this skill. Under-calling a conflict is a one-way door — a logo on trucks, a product launched, a TM application filed, all with a problem underneath. Over-calling is a two-way door — the attorney narrows the list in review. Stay on the two-way-door side.

---

## Jurisdiction assumption

Default jurisdiction is **US (USPTO/TESS + common law)** and **North Carolina** for state-law issues, unless the attorney specifies otherwise. Surface this assumption at the top of every output and adjust if the attorney corrects it.

---

## Matter context

If a matter or client is in the current conversation context, ground all output in that matter. If no matter is active, ask: "Which matter or client is this for?" before proceeding. Do not carry findings from one matter into another.

---

## Firm positions

If the attorney has stated a risk posture or playbook in this conversation, apply it. If no position is given and a subjective call is required (e.g., how aggressively to weigh a weak prior mark), ask one short clarifying question, or use a conservative default and flag the assumption explicitly. Never invent a firm-specific position as authoritative.

---

## Intake

Ask once, in a single batch:

> A few questions before I run the triage:
>
> 1. **Proposed mark.** Exact spelling, any stylization, and whether it's a word mark, logo, or both.
> 2. **Goods or services.** What's actually being sold or offered under this mark. A sentence or two — I'll map to Nice classes.
> 3. **Classes.** If you already know the Nice classes, list them. Otherwise describe the goods/services and I'll suggest the likely classes and confirm before running the triage.
> 4. **Jurisdictions.** Where do you plan to use, register, or enforce? (Default: US. Say "NC only" for state-level, or name international jurisdictions.)
> 5. **How it will appear in use.** Any taglines, adjacent product names, trade dress, or design elements that would show up with it in the market.

Wait for the answer. If the description is vague ("AI tool," "platform"), push once:

> Give me the actual thing a customer sees — is it a consumer mobile app, enterprise API, physical product, service? The classes turn on this.

---

## Step 1 — Knockout check (intrinsic bars)

Before any search, assess these bars that can kill a mark regardless of prior registrations. For each, assess plainly and flag. Do not rationalize away a clear issue.

| Bar | What it means | Flag when |
|---|---|---|
| **Generic** | The term IS the category (e.g., "Soap" for soap) | The mark names what the thing is |
| **Descriptive** | Directly describes a feature, function, quality, or ingredient | A consumer reads the mark and knows what the product does without imagination |
| **Deceptive / deceptively misdescriptive** | Misrepresents a material feature | The mark suggests a quality the goods don't have and that quality would matter |
| **Primarily geographically descriptive / deceptive** | Mark is primarily a place name and goods come from (or don't) that place | Mark = place + generic; or place + goods where customers would assume origin |
| **Primarily merely a surname** | Mark is primarily a surname | Mark reads as someone's last name to the relevant consumer |
| **False connection** | Mark falsely suggests connection with a person, institution, or national symbol | Mark invokes a specific identifiable person or institution |
| **Prohibited matter** | Flags, coats of arms, insignia, specific prohibited categories | Mark contains a prohibited element |
| **Functional (for design marks / trade dress)** | The feature is essential to use or affects cost/quality | Design mark where the feature performs a function |

Note: After *Iancu v. Brunetti* (2019) and *Matal v. Tam* (2017), the USPTO no longer refuses on scandalous/immoral grounds. The surviving bar in that zone is false connection under §2(a). Apply that; don't flag under the struck-down bars.

**Output:** for each knockout category, either "no issue identified" or a specific flag with a one-line reason. Don't produce a blank table of passes.

---

## Step 2 — Similar marks check

The purpose is to **find potentially confusingly similar prior marks**, not to decide whether confusion is likely. That determination belongs to the attorney.

### Search approach

Use web_search and any documents or registrations the attorney provides. Search for:
- The exact proposed mark in USPTO TESS (via web search or attorney-provided records)
- Phonetic variants, near-spelling variants, and similar-sounding marks
- State trademark registries (NC Secretary of State and others in relevant jurisdictions)
- Common-law uses (websites, directories, trade press, social handles)
- International registries (EUIPO, WIPO Madrid Portal) if foreign jurisdictions are in scope

**Always state explicitly what was and was not searched.** Do not present web-search findings as a database search. Do not infer registration details from model knowledge and present them as search results.

If you cannot reach a result through web_search or attorney-provided documents, write:

> **No database record confirmed for this search.** This triage did not hit TESS, state registries, EUIPO, WIPO, or common-law sources for [the item in question]. A professional search across those databases is required before any conclusion about availability.

### For each similar mark found or supplied

Capture:
- **Mark** (exact characters, any stylization)
- **Source** (USPTO registration no., EUIPO/WIPO designation, state registry, URL, or attorney-supplied document)
- **Classes / goods-services description** from the record
- **Owner**
- **Status** (registered / pending / abandoned / cancelled — a dead mark is not a bar but is relevant)
- **First-use date if available**

Do not supplement silently. If you cite a USPTO registration number, it came from the search you ran or a record the attorney provided. Never invent a registration number. If a detail is not in the record, write "not available from source."

### Adjacent families sweep (required before concluding)

A triage that only checks exact and near-exact matches misses the marks a competitor adopted because the direct mark was taken. Before concluding, identify 3–5 adjacent word families for the practitioner to also sweep:

- **Category synonyms** for the root word(s)
- **Product-category-conventional names** in the same class
- **Phonetic twins** on the root (alternate spellings, dropped letters, added syllables)
- **Translation equivalents** (if any foreign jurisdiction is in scope — the EU's foreign-equivalents doctrine treats a translation as the same mark for confusion purposes)

Present these as a confirmation block:

> **Adjacent families to sweep (please confirm or add):**
> - [family 1]
> - [family 2]
> - [family 3]
> - [family 4 — phonetic twins]
>
> A clearance that only checks exact and near-exact matches misses the marks a competitor adopted because yours was taken. Confirm this list is complete for the category before the full professional search is ordered.

If non-English-speaking jurisdictions are in scope, add: transliteration equivalents, script-variation marks, and translation equivalents. If you cannot perform cross-language analysis, say so explicitly: "Cross-language phonetic and translation-equivalent analysis not performed — this is the most common source of cross-border conflicts. A clearance search in [jurisdiction] should include it."

---

## Step 3 — Likelihood-of-confusion factors

> **Confusion framework is jurisdiction-specific.** Apply the right test for where the client plans to file and enforce.
>
> - **US (federal/TTAB):** *In re E. I. du Pont de Nemours & Co.*, 476 F.2d 1357 (C.C.P.A. 1973) (13 factors). For circuit-specific enforcement: *Polaroid* (2d Cir.), *Sleekcraft* (9th Cir.), *Frisch's Restaurants* (6th Cir.), *Lapp* (3d Cir.), *Scotch Whisky Association* (7th Cir.).
> - **EU (EUTMR Art. 8(1)(b)):** Global appreciation — holistic assessment, greater weight on phonetic similarity, translation equivalents standard, "likelihood of association" beyond source confusion.
> - **UK (TMA 1994 §5(2)):** Follows EU global appreciation approach but diverging post-Brexit. Check for UK-specific decisions.
> - **Other jurisdictions:** State the applicable framework or say: "I don't have [jurisdiction]'s confusion framework. Options: (a) I search for the applicable standard, (b) you route to a [jurisdiction] trademark specialist, (c) I note this jurisdiction is out of scope." Never silently apply US doctrine to a foreign jurisdiction.

Identify which test applies (based on primary filing/enforcement jurisdiction), cite it in the output, and walk each factor as a **flag**, not a verdict:

| Factor | Flag | Direction |
|---|---|---|
| Similarity of marks (sight / sound / meaning / commercial impression) | [note what cuts each way] | [toward conflict / against / mixed] |
| Similarity of goods or services | [note] | [direction] |
| Channels of trade | [note] | [direction] |
| Consumer sophistication | [note] | [direction] |
| Strength of prior mark | [note] | [direction] |
| Intent | [note] | [direction] |
| Actual confusion | [note or "no evidence surfaced"] | [direction] |
| Likelihood of expansion / bridge-the-gap | [note] | [direction] |

**This skill never concludes "not confusingly similar."** If uncertain, write: "Similar marks found — attorney confusion assessment required before adoption." Or: "Factors cut both ways; attorney judgment required." A "no similar marks found in the databases searched" conclusion is acceptable only when a real search was documented.

---

## Output format

Present the result in chat for the attorney to review and save in the app if they choose.

```
# Trademark Clearance — First Pass (NOT AN OPINION)

**This is a first pass, not a clearance opinion.** [repeat the guardrail verbatim]

**Triage result:** [GREEN / YELLOW / RED — one sentence why]
**Jurisdiction assumed:** [US/NC or as specified — flag if defaulted]

## Proposed mark

- **Mark:** [exact text, stylization noted]
- **Mark type:** [word / design / composite]
- **Goods / services:** [description]
- **Classes:** [Nice class numbers with one-line descriptions]
- **Jurisdictions:** [US / EU / UK / specific countries]
- **Confusion test applied:** [du Pont / Polaroid / Sleekcraft / other — with reason]

## Knockout issues

| Bar | Flag | Note |
|---|---|---|
| [each bar] | [none / flagged] | [one line if flagged] |

## Similar marks check

**Sources searched:** [what was searched, via web_search or attorney-provided docs, with dates — or "no database search run; see scope note below"]
**Scope:** [classes, jurisdictions, exact vs. fuzzy, design search or not]

**Adjacent families to sweep (confirm or add):**
- [family 1]
- [family 2]
- [family 3]
- [family 4 — phonetic twins]

| Mark | Source | Classes / G&S | Owner | Status | First use | Note |
|---|---|---|---|---|---|---|
| [exact] | [source] | [class list] | [owner] | [reg/pending/abandoned] | [date or "not available"] | [why it matters] |

[If no database search ran: "No database search was run. This triage did not hit TESS, state registries, EUIPO, WIPO, or common-law sources. A professional search across those databases is required before any conclusion about availability."]

## Confusion factors — flags for attorney review

[Table per Step 3 above]

**Conclusion on confusion:** This skill does not conclude. [Choose applicable:]
- "Similar marks found; attorney confusion assessment required before adoption."
- "No similar marks found in the databases searched; full clearance required before adoption."
- "Factors cut both ways; attorney judgment required."

## Recommended next steps

[Bucket by findings — see next section]

## Citation verification

Every case, registration number, statute, and database result in this memo must be verified against the authoritative source before relying on it. Registration numbers, class designations, and first-use dates are the most common sites of error.
```

---

## Recommended next steps (decision tree)

Tailor to what the triage found. Default buckets:

- **If knockout issues found:** Reframe the mark or accept the descriptiveness bar and plan for secondary meaning over time. Attorney review required before adopting.
- **If similar marks found:** Attorney review is required before adopting, filing, or marketing. Next step is typically a full professional search to find what the triage missed.
- **If no similar marks found but no real database search ran:** A full professional search is required before adoption. Name the databases that need to be searched.
- **If similar marks found but the senior mark is weak, old, in a different class, or abandoned:** Flag for attorney review. The triage will not make this call.
- **Always:** A full clearance opinion from registered trademark counsel, scaled to the investment the mark will carry. A mark going on a product line or advertising campaign carries more weight than a mark for a one-off event.

End with a short decision tree presenting the attorney's options given the specific findings:
- Draft a design-around
- Order a full professional search
- Reframe/rename the mark
- Proceed to USPTO application (with identified risks on record)
- Get more facts (identify what is missing)
- Watch and wait
- Something else

The attorney picks the branch.

---

## What this skill does not do

- **Conclude a mark is clear.** Ever.
- **Substitute for a full TESS search, state-registry search, common-law search, international search, watch-service check, or design-mark search.** Web search is a best-effort proxy; it is not a professional trademark search.
- **File a trademark application.** Filing is an attorney task; this skill informs the decision to file.
- **Evaluate trade dress, dilution, or famous-mark claims** beyond a preliminary flag. Dilution under the TDRA requires a fame analysis this skill does not attempt.
- **Address foreign local-law bars** (phonetic similarity standards in Japan, translation equivalents in the EU, etc.) beyond flagging that foreign analysis is required when a foreign jurisdiction is in scope.
- **Replace attorney judgment on likelihood of confusion.** The factors produce flags, not verdicts. The attorney owns the legal conclusion.

---

## Tone

Crisp, concrete, honest about scope. The attorney reading this output should know in ten seconds what the triage found, what it didn't, and what has to happen before anyone adopts the mark. No hedging prose. The guardrail at the top and "this skill does not conclude" on confusion do the scope work.
