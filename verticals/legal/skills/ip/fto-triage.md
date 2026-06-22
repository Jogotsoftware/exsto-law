---
slug: ip.fto-triage
name: Freedom to Operate Triage
practice_area: ip
description: Structured first-pass review of potentially blocking patents — element-by-element claim charts, risk flags, and recommended next steps — stopping well short of an FTO opinion.
when_to_use: When a client asks whether a product, process, or feature is blocked by existing patents, when preparing for a launch in a patent-active technology space, or when a specific patent or NPE letter has surfaced and needs a structured first look.
user_invocable: true
---

## THIS IS NOT A FREEDOM-TO-OPERATE OPINION

**Say this at the top of every output. Do not drop it. Do not soften it.**

> **This is not a freedom-to-operate opinion.** An FTO opinion is a professional legal judgment, usually by registered patent counsel, based on a comprehensive search, full claim construction, and an element-by-element infringement analysis against each claim of each relevant patent. This triage is a structured first look at what might be out there. A "no obvious blocking patents" result means the triage didn't find one — it does not mean the product is clear. Patent infringement is strict liability; willful infringement (which can follow from knowing about a patent and proceeding anyway) triples damages under 35 U.S.C. § 284. The decision to launch, make, use, sell, or import is a business decision informed by a formal FTO study and counsel's judgment — not by this triage. A registered patent attorney or agent evaluates before anyone relies on this for a product decision.

Under-flagging a blocking patent is a one-way door — a product launched, a deposition a year later, treble damages on the table. Over-flagging is a two-way door — the attorney narrows the list in a read-through. Stay on the two-way door side. Always.

### A note on willfulness

Reading this triage is reading something about patents. Reading something about patents can, in some circumstances, factor into a willfulness analysis down the road. This output is a privileged work product. Do not quote it to counterparties or share it outside the privilege circle.

---

## Getting started

If a matter and client are in context, ground your analysis in them. If no matter is in context, ask: "Which matter or client is this for?" one short question before proceeding.

If the attorney has stated firm positions on FTO risk appetite (e.g., "we don't launch anything with an unresolved yellow"), apply them. If no position is given, use a conservative default — flag rather than clear — and explicitly note: "[ASSUMPTION: conservative default applied — flag uncertain elements rather than clear them. Adjust if the firm's posture differs.]"

---

## Intake

Ask in a single batch if you don't already have the information from context:

> I'll run an FTO triage. A few questions first:
>
> 1. **Product, process, or feature.** What's being made, used, offered for sale, sold, or imported? Describe it plainly — the technical essence, not the marketing pitch.
> 2. **Technical detail.** Any architectural diagrams, claim-relevant specs, a public product page, or a spec document you can share? (The more detail, the more real the triage.)
> 3. **Jurisdictions.** Where will it be made, used, sold, offered for sale, or imported? (Each is a separate infringing act under 35 U.S.C. § 271. I'll default to the US if you don't specify.)
> 4. **Known patents.** Are there patents already on your radar — a competitor's portfolio, a known SEP pool, an NPE letter, something an engineer mentioned?
> 5. **Timing.** How close is this to launch? If it's months out, design-around is still on the table. If it's already shipping, we're in cover-our-downside mode.

If the description is vague ("an AI agent," "a database"), push once:

> Give me the technical essence — what does the thing do, how does it do it, and what's the piece you think might be novel? Patent claims live at that level.

---

## Scope — utility patents only

**This skill analyzes utility patents.** If a patent on the radar has a `D`, `RE`, or `PP` prefix, flag it and route out — do not claim-chart it:

- **`D` (design patent).** Different test entirely — ordinary observer under *Egyptian Goddess, Inc. v. Swisa, Inc.*, 543 F.3d 665 (Fed. Cir. 2008) (en banc), overall ornamental appearance, no claim chart. Flag as a separate workstream requiring design patent counsel.
- **`RE` (reissue).** Treat as a utility patent with added § 252 intervening-rights and recapture-rule flags.
- **`PP` (plant patent).** Out of scope; route to plant-patent counsel.

Also cross-flag **trade dress**: if the product's appearance is the risk, the same facts may be a § 43(a) product-configuration claim requiring secondary meaning (*Wal-Mart Stores, Inc. v. Samara Bros., Inc.*, 529 U.S. 205 (2000)) and non-functionality (*TrafFix Devices, Inc. v. Marketing Displays, Inc.*, 532 U.S. 23 (2001)). Flag as a parallel track.

---

## Search

**No patent database is directly connected to this assistant.** Use `web_search` to retrieve publicly available patent information (Google Patents, Espacenet, USPTO Patent Full-Text, Unified Patents, PTAB proceedings). State your query and what you found.

Write this in every output:

> **Search scope and limits.** Patent search in this triage used web_search and any documents or patent numbers the attorney provided. A comprehensive search via USPTO PatentCenter, EPO Espacenet, Google Patents, PatSnap, or Solve Intelligence Patents is required before relying on this triage for any launch decision. The analysis below is limited to patents and applications surfaced via web_search or named by the attorney.

Then proceed. The claim-chart work is still valuable — just label the scope honestly.

### Supplementary signals (not a substitute for a search)

If available, note non-patent signals that flag a concern:

- Competitor patent filings in the product area.
- Known NPE targeting of the technology class (e.g., network-coding NPEs in Eastern District of Texas / Delaware / Western District of Texas).
- Standards-essential declarations (IEEE, ETSI, 3GPP) if the product touches a relevant standard.
- Reported litigation in the technology space (CourtListener / RECAP, Unified Patents, Lex Machina — search publicly available dockets).

Each signal is a reason to search harder, not a patent hit. Mark them as signals, not identified patents.

---

## For each relevant patent found or supplied

Capture:

- **Patent number** (with application number if different) and **jurisdiction**
- **Title**
- **Assignee and inventors**
- **Priority date and issue date**
- **Expiration date** (check term adjustments, term extensions, and terminal disclaimers — note "expiration date not independently verified from PatentCenter" if not confirmed)
- **Maintenance fee / in-force status** — if a US patent has failed a 3.5/7.5/11.5-year maintenance fee, it is expired and not a bar; note if unverified
- **Claim count — independent and dependent**
- **Independent claims as issued** (and any relevant amended claims from post-grant proceedings)
- **Related proceedings** — IPRs, PGRs, reexaminations, litigation history, PTAB outcomes
- **File wrapper highlights** — prosecution disclaimers, amendments that narrowed the claims, statements about scope

**Do not supplement silently.** Never invent a patent number, never "fill in" a claim element the file doesn't support, never imagine an expiration date. If maintenance fee status is unavailable, write: "maintenance fee status not verified — confirm in PatentCenter before relying on in-force status."

---

## Claim-chart first pass

This is the core of the triage. Pick the 2–5 patents with the most plausible read on the product and walk each independent claim element-by-element.

**For each selected patent, write one claim chart per independent claim:**

| Claim element | Does the product practice this? | Basis |
|---|---|---|
| "A [preamble phrase]" | [yes / no / possibly / depends on construction] | [one sentence — what in the product maps; what doesn't; what's ambiguous] |
| "comprising [element 1]" | [yes / no / possibly] | [mapping or gap] |
| "wherein [element 2]" | [yes / no / possibly] | [mapping or gap] |
| [continue for every element] | | |

**Rules for the chart:**

- **Every element matters.** A claim is infringed only if the accused product practices every element of at least one claim (all-elements rule). Missing one element literally means no literal infringement on that claim. Do not skip elements.
- **Doctrine of equivalents is a separate pass.** First chart literal infringement. Then, for any "no" elements, note whether a DOE read is plausible (insubstantial differences / function-way-result). Flag DOE analysis as requiring attorney judgment — prosecution history estoppel and claim vitiation are common bars and the triage does not adjudicate them.
- **Claim construction is the attorney's job.** Where a term could be construed narrowly or broadly and the answer changes the infringement read, flag the term and note both constructions. Do not pick one silently.
- **Indirect infringement (induced, contributory) and divided infringement** are flags only. Note that these may apply and require patent counsel; do not attempt a full analysis.

> **Jurisdiction note.** The US claim-charting framework (all-elements rule, doctrine of equivalents, prosecution history estoppel, § 284/§ 289 damages) does not transfer directly to other systems. Germany has utility models (Gebrauchsmuster) and bifurcated validity/infringement proceedings. China has utility models (shiyong xinxing) and CNIPA examination. Japan has a narrower DOE. The EU Unified Patent Court procedure applies since 2023. When non-US jurisdictions are in scope: "This analysis uses the US claim-charting framework. A product manufactured in China and sold in the EU needs CNIPA and EP analysis, not a US claim chart. I can flag the issues a US analysis surfaces, but the infringement and validity calls require jurisdiction-specific review."
>
> **Jurisdiction assumption:** Unless you specify otherwise, this triage defaults to US law and jurisdiction. If the client's product will be made, used, sold, or imported outside the US, flag those jurisdictions explicitly and note that separate analysis is required. [ASSUMPTION flagged.]

**Decision posture:** This skill never concludes "no infringement." Every result is one of:

- "Product practices every element of Claim X as written; attorney review required before proceeding."
- "One or more elements are not clearly present; attorney review required to assess literal infringement and doctrine of equivalents."
- "Claim construction is dispositive on element [Y]; attorney construction required before proceeding."

---

## Open questions

Every patent surfaced should produce a list of open questions a real FTO study would answer. Examples:

- Is the patent enforceable — any standing issues, inventorship defects, recorded assignments?
- What did the applicant say about term [X] in prosecution, and does that limit the claim?
- Has this claim been the subject of an IPR or reexamination — what did the PTAB say about scope or validity?
- Is there a license already available (standards pool, patent marking, open patent non-assertion commitment)?
- What is the real-world enforcement history of this assignee?

---

## Recommended next steps

Bucket by what the triage found:

- **If every element of an independent claim maps to the product (literal read):** Stop and get patent counsel. Options typically include formal FTO opinion, design-around, license, challenge validity (IPR/PGR), or (rarely) proceed at risk. The choice is a business decision informed by counsel.
- **If elements cut both ways or claim construction is dispositive:** Full FTO study by registered patent counsel. Do not launch on this triage.
- **If the patent appears expired, abandoned, or unenforceable:** Attorney confirms in-force status — the triage does not.
- **If no patents were identified but no comprehensive database search ran:** Formal search is the next step, not a launch decision.
- **Always:** Flag willfulness risk. If the triage surfaces a specific patent, the client now has knowledge of it. Proceeding without further analysis can support a willfulness finding. Counsel should document the path forward.

---

## Output format

Present the result in chat for the attorney to review (and save to the matter in the app if they choose).

```markdown
# FTO Triage — First Pass (NOT AN OPINION)
**PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION / ATTORNEY WORK PRODUCT**
*Prepared by: [attorney name] | Matter: [matter name] | Date: [date]*

**This is not a freedom-to-operate opinion.** A formal FTO opinion requires a comprehensive search, full claim construction, and element-by-element infringement analysis by registered patent counsel. Patent infringement is strict liability; willful infringement triples damages. A "no obvious blocking patents" result means the triage didn't find one — it does not mean the product is clear. A registered patent attorney or agent evaluates before anyone relies on this for a product decision.

**Triage result:** [GREEN / YELLOW / RED — one sentence why]

## Subject

- **Product / process / feature:** [description, technical essence]
- **Technical detail relied on:** [what was reviewed — spec, diagram, public page, engineer's description, documents in matter]
- **Jurisdictions in scope:** [make / use / sell / offer / import — per § 271]
- **Timing:** [pre-launch / near-launch / shipping]

## Search scope

- **Search method:** web_search + attorney-supplied patents/documents
- **Comprehensive database search run:** No — confirm USPTO PatentCenter / Espacenet / Google Patents search before relying on this triage for a launch decision
- **What wasn't searched:** named-assignee sweeps, SEP declarations, NPE portfolios, design patents, foreign equivalents — as applicable

## Patents identified

| Patent | Jurisdiction | Assignee | Priority / Issue | Expiration | In-force? | Source |
|---|---|---|---|---|---|---|
| [number] | [US/EP/...] | [assignee] | [dates] | [date] | [yes/no/unverified] | [web_search result or "attorney-supplied"] |

## Claim charts — first pass

### [Patent number] — independent Claim [N]

> "[Exact text of Claim N]"

| Element | Practiced by the product? | Basis |
|---|---|---|
| [element 1] | [yes/no/possibly] | [mapping or gap] |
| [element 2] | [yes/no/possibly] | [mapping or gap] |

**Literal read:** [every element maps / one or more elements do not clearly map / claim construction is dispositive on element [Y]]

**Doctrine of equivalents (flag only):** [DOE read plausible on element [Y] — attorney construction required / not plausible / prosecution history suggests estoppel]

**Indirect / divided infringement (flag only):** [note if any read depends on induced, contributory, or divided infringement theories — attorney analysis required]

*(Repeat for each independent claim of each selected patent.)*

## Open questions

- [question 1]
- [question 2]

## Signals (not confirmed patents)

- [competitor filings / NPE activity / SEP declarations / litigation in the technology space — each a reason to search harder, not an identified patent]

## Recommended next steps

- [full FTO study by patent counsel — first-line recommendation unless comprehensive search already ran and found nothing]
- [design-around options if a literal read was found]
- [license / IPR / PGR / at-risk analysis as counsel directs]

## Willfulness note

This triage surfaces specific patents. Proceeding with the product without further counsel review after this knowledge can support a willfulness finding and enhanced damages under § 284. The path forward should be documented by patent counsel; the business decision to launch, design around, or license is informed by a formal FTO opinion and counsel's judgment, not by this triage.

## Citation verification

Every patent number, claim quote, date, and prosecution fact in this memo must be verified against the authoritative source (USPTO PatentCenter, EPO register, national equivalent) before relying on it. Claim quotes are the most common error site — a single word changes the analysis.
```

---

## Next-steps decision tree

End every triage with a decision tree for the attorney:

> **What do you want to do next?**
> - **Draft a memo to the client** summarizing the triage findings and recommended next steps
> - **Build a fuller claim chart** on the highest-risk patent
> - **Search harder** on a specific patent class, assignee, or jurisdiction
> - **Get more facts** from the client (technical spec, launch timeline, known agreements)
> - **Something else** — just tell me

---

## What this skill does not do

- **Issue an FTO opinion.** Ever.
- **Construe claims.** Where construction is dispositive, it flags the term and both plausible constructions. It does not pick one.
- **Adjudicate validity.** It may note known PTAB proceedings; it does not opine on novelty, obviousness, § 112, § 101, or enablement.
- **Draft patent claims.** Route to prosecution counsel.
- **Assess damages exposure.** Damages modeling is an expert's job.
- **Handle trade-secret or trademark analysis.** Flag and route to the appropriate track.
- **Quote outputs to counterparties or non-privileged audiences.** This is a privileged research document.
- **Access Westlaw, CoCounsel, CourtListener, PatSnap, Solve Intelligence, or any patent database directly.** Use web_search and attorney-supplied documents; flag what a comprehensive database search would add.

---

## Tone

Technically precise. Element-by-element. Every flag is specific to a claim element or a known patent. No hedging prose in the body — the guardrails at the top and bottom do the scope work, and the analysis does the analysis. The reader should leave knowing what the triage looked at, what it didn't, and what the next step is.
