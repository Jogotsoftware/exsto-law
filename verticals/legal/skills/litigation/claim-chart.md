---
slug: litigation.claim-chart
name: Claim and Element Chart Builder
practice_area: litigation
description: Build or review a patent claim chart (infringement, invalidity, or audit) or a civil element chart for any cause of action or defense, with every cell pin-cited and gap detection as the priority output.
when_to_use: When the attorney asks for a claim chart, element chart, proof chart, infringement or invalidity contentions, element-by-element mapping, or "what are we missing to prove [claim]."
user_invocable: true
---

# Claim and Element Chart Builder

## Every output is a draft for attorney review

**Put this at the top of every chart output. Do not drop it. Do not soften it.**

> This chart is a draft for attorney analysis and verification — not a filed contention, an MSJ brief, an opening statement, or a legal opinion. Every mapping is a lead the attorney must verify against the source. The elements listed come from pattern jury instructions, the Restatement, or the claim language as parsed — the **controlling** authority in the applicable jurisdiction may differ and always controls. Gap detection is a starting point for discovery or a motion; it is not a conclusion about the merits.

Under-flagging a gap is a one-way door — a complaint filed without plausibility on an element, an MSJ response served without evidence for a disputed element, or a case tried without proof of damages. Over-flagging is a two-way door — the attorney clears flags in review. The default is biased toward the two-way door.

---

## Disclosed-document use restrictions

Before working with litigation documents, ask: "Were any of these documents obtained through disclosure or discovery in legal proceedings?" If yes:

- **US (Rule 26(c) / protective orders):** Check the protective order. Documents produced in one matter may not be usable in another without consent or court permission.
- **England & Wales (CPR 31.22):** The implied undertaking restricts use to the proceedings in which documents were disclosed.
- **Other jurisdictions:** Similar restrictions commonly apply.

Confirm: "This use is within the proceedings in which the documents were disclosed, or I have permission / consent, or the documents are now public." If not confirmed, flag: "⚠️ Disclosed documents may have use restrictions. Confirm this use is permitted before proceeding."

---

## Matter context

If a matter and client are loaded in your context, ground the chart in that matter — use the side, jurisdiction, phase, and theory already established. If no matter is in context, ask: "Which matter is this for? And are you asserting or defending?"

Apply the firm's stated positions if provided in your context. If a position is not given, ask one short clarifying question or use a conservative default and explicitly flag the assumption.

---

## Mode selection

Ask at the top, before anything else:

> Which kind of chart?
>
> 1. **Patent claim chart** — element-by-element mapping of claim limitations against an accused product (infringement), prior art (invalidity), or another party's chart (audit). For patent contentions, IPR petitions/responses, FTO analysis.
> 2. **Civil element chart** — elements of a cause of action (or affirmative defense) mapped against the evidence. For complaint plausibility checks, discovery planning, MSJ prep, order-of-proof outlines.

Plus intake (common to both):

- **Side.** Asserting or defending? (In civil mode this flips the burden; in patent mode it flips infringement/invalidity framing.)
- **Jurisdiction / forum.** State and court — pattern instructions vary (CACI in California, NYPJI in New York, federal circuits' pattern charges, state-specific variations). In patent mode, Patent Local Rules vary (N.D. Cal., E.D. Tex., D. Del., ITC, PTAB). Default to **North Carolina / Middle District of NC** if not specified and flag the assumption.
- **Phase.** Pre-filing, pleadings, discovery, MSJ, trial prep, post-trial. The chart is the same; the framing of the output changes.
- **Existing chart?** If auditing, the attorney pastes or describes the chart.

---

# MODE 1 — Patent Claim Chart

## Sub-modes

- **Infringement** — claim elements vs. accused product (PLR 3-1 infringement contentions, IPR/PGR response exhibits, complaint exhibits)
- **Invalidity** — claim elements vs. prior art (PLR 3-3 invalidity contentions, IPR/PGR petition exhibits, §102/§103 defenses)
- **Audit** — review a chart someone else produced

## Additional patent-mode intake

- **Patent number and asserted claims.** Which independent, which dependent. (Do not chart unasserted claims unless asked.)
- **Priority date.** Establishes the §102 bar and the effective filing date for the AIA / pre-AIA regime.
- **Existing constructions.** Markman order, stipulated constructions, constructions proposed in briefing.

## Patent-mode workflow

### Step 1: Parse the claims

Parse asserted independent claims into numbered elements. Handle:

- **Preamble.** Note whether it's limiting — a question of claim construction (*Catalina Marketing Int'l, Inc. v. Coolsavings.com, Inc.*, 289 F.3d 801 (Fed. Cir. 2002)). Flag `preamble-limiting: unresolved` unless the construction order resolves it.
- **Transitional phrase.** "Comprising" (open) / "consisting of" (closed) / "consisting essentially of" (semi-open). Affects whether additional unrecited elements defeat infringement.
- **Elements** separated by commas / semicolons, numbered `[1a]`, `[1b]`, `[1c]`. Keep numbering stable — it is the chart's spine.
- **Means-plus-function (§112(f))** — every "means for [function]" or non-structural functional term. Scope is the structure disclosed in the spec plus equivalents. Cite corresponding structure by col./line. If the spec fails to disclose structure, flag `indefinite-112f`.
- **Markush groups, Jepson claims, product-by-process, method-step order dependencies** — flag with a note on unusual construction rules.
- **Dependent claims** — reference parent; chart only the additional limitations. If asserted claims include dependents, produce actual rows for each — do not emit a placeholder note that rows "should be produced."

**Structural-term cognates — default to `construction-dependent`.** For each element that recites a structural noun with a common cognate in the field, default the row's state to `literal-construction-dependent` unless the spec expressly defines the term or an existing Markman order forecloses the ambiguity. Common cognate families to flag proactively:

| Field | Cognate family |
|---|---|
| Fasteners / anchors | barb / thread / projection / ridge / fin / tooth |
| Fluidics / catheters | lumen / channel / bore / passage / conduit |
| Mechanical housings | hub / boss / flange / collar / shoulder |
| Fasteners / joints | socket / recess / pocket / cavity |
| Electrical / electronic | contact / terminal / pad / lead |
| Optical | lens / reflector / window / aperture |
| Structural | wall / member / support / strut / rib |
| Surfaces | surface / face / interface |

Show the parse to the attorney and confirm before mapping. A wrong parse poisons every row below it.

### Step 2: Claim construction check

Flag disputed terms:

- Coined terms or terms defined in the spec
- Terms with prosecution history (amendments, arguments, disavowals — *Phillips v. AWH Corp.*, 415 F.3d 1303 (Fed. Cir. 2005); *Festo* estoppel)
- Functional language ("configured to," "adapted to," "operable to")
- Relative terms ("substantially," "about") — definiteness risk under *Nautilus, Inc. v. Biosig Instruments, Inc.*, 572 U.S. 898 (2014)
- Computer-implemented terms — Alice / §101 exposure for invalidity

For each flagged term, state the construction(s) under which the mapping works and the construction(s) under which it fails. If a Markman order exists, apply it. If briefing is underway, chart under each side's proposed construction.

### Step 3: Map

For each element, for each target:

1. **Find evidence.** Accused product: documentation, manuals, data sheets, source code, teardowns, deposition testimony, expert reports (or documents the attorney provides). Prior art: column/line for US patents, paragraph for published apps, page/figure for non-patent literature. If you lack access to official patent databases, use `web_search` to locate the patent or the product documentation and note that the attorney should verify the retrieved text against the official source.
2. **Quote verbatim.** Character-for-character. No paraphrase. Cut at sentence boundaries and mark elision with `[…]`.
3. **Characterize the mapping.**

   | Mapping | Meaning | Where |
   |---|---|---|
   | `literal` | Claim language reads on the accused feature / prior-art disclosure | Both |
   | `literal-construction-dependent` | Literal under X; fails under Y | Both |
   | `doe` | Equivalent (function-way-result or insubstantial differences) | Infringement only |
   | `anticipation` | Every element in a single reference, arranged as claimed (*Net MoneyIN, Inc. v. VeriSign, Inc.*, 545 F.3d 1359 (Fed. Cir. 2008)) | Invalidity only |
   | `obviousness-combination` | Secondary reference supplies the missing element; motivation to combine required under *KSR Int'l Co. v. Teleflex Inc.*, 550 U.S. 398 (2007) | Invalidity only |
   | `partial` | Some of the element is present | Both |
   | `not-found` | Element not present | Both |
   | `needs-evidence` | Cannot tell from available material | Both |
   | `construction-dependent` | Turns on how a disputed term is construed | Both |

4. **Flag open questions.** "This maps if [X]. Need [teardown / source code / deposition / expert] to confirm."

**No silent supplement.** Thin documentation means `needs-evidence`, not extrapolation from similar products.

### Step 4: Dependent claims — execute, don't gesture

For each asserted dependent claim, produce actual rows charting the additional limitation(s) against the target. Note the parent dependency; infringement / invalidity of the dependent requires the parent's. Do not skip dependents silently — if dependent claims cannot be charted in this run, say so explicitly and list which ones were deferred.

A dependent-claim row format:

```
| [#] | Element (verbatim) | Accused feature (or prior-art disclosure) | Evidence (pin-cited) | Mapping | State | Verified |
|---|---|---|---|---|---|---|
| 2 [add'l] | "wherein the barb extends at an angle of 15° to 30° from the body axis" | AnchorFast Mini barb angle 18° per [CM-AM-2026-03 Fig. 4 + §2.3] | [CM-AM-2026-03 §2.3] "barb angle 18° ±2°" | literal-construction-dependent | mapped | ☐ |
```

### Step 4.5: DOE supplements — execute, don't gesture

For every element charted as `literal` where the accused feature is structurally similar but not literally identical — or where the `literal` mapping turns on a contested construction — produce a **paired DOE candidacy row** (infringement mode). Do not footnote "DOE analysis is separate" without producing the actual DOE mapping.

A DOE candidacy row adds a one-paragraph function-way-result sketch, flags prosecution history estoppel and dedication-to-the-public risks per element, and cites the evidence that would support the equivalent. If DOE is inapplicable, skip. If `literal` is construction-dependent and DOE would be the fallback under the narrower construction, produce the DOE row.

Format:

```
| [#-DOE] | Element | Accused feature | Function-way-result | PH estoppel? | Dedication risk? | State |
|---|---|---|---|---|---|---|
| 1b-DOE | "at least one barb" | three-barb opposing-face array | function: resist withdrawal; way: mechanical engagement with bone; result: anchor remains seated under tensile load | [needs-evidence: prosecution history] | [needs-evidence: disclosed-but-unclaimed alternatives in spec] | construction-dependent |
```

If the skill cannot produce DOE rows because of missing evidence, say so explicitly and route to `needs-evidence`. Do not skip DOE silently.

### Step 5: Indirect, divided, willfulness (infringement only)

Flag, do not opine:

- **Induced (§271(b))** — *Commil USA, LLC v. Cisco Systems, Inc.*, 575 U.S. 632 (2015); *Global-Tech Appliances, Inc. v. SEB S.A.*, 563 U.S. 754 (2011)
- **Contributory (§271(c))** — component especially made for infringing use
- **Divided / joint (§271(a))** — *Akamai Techs., Inc. v. Limelight Networks, Inc.*, 797 F.3d 1020 (Fed. Cir. 2015) (en banc)
- **Willfulness** — *Halo Elecs., Inc. v. Pulse Elecs., Inc.*, 579 U.S. 93 (2016); treble damages under §284

### Step 6: Invalidity thresholds (invalidity only)

For §102: every element in a single reference. Partial across references is §103.

For §103: primary reference + secondary reference(s) + documented motivation under *KSR*. Flag explicit teaching/suggestion/motivation, market or design-need motivation, reasonable expectation of success, and **secondary considerations** (*Graham v. John Deere Co.*, 383 U.S. 1 (1966)) — commercial success, long-felt need, failure of others, industry praise, copying.

Also flag:
- **§101** — *Alice Corp. Pty. Ltd. v. CLS Bank Int'l*, 573 U.S. 208 (2014); *Mayo Collaborative Servs. v. Prometheus Labs., Inc.*, 566 U.S. 66 (2012)
- **§112 ¶ 1** — written description, enablement (*Amgen Inc. v. Sanofi*, 598 U.S. 594 (2023))
- **§112 ¶ 2** — definiteness (*Nautilus*, supra)
- **§112 ¶ 6** — means-plus-function structure
- **Unenforceability** — inequitable conduct, prosecution laches, assignor/licensee estoppel (attorney-only flags)

Invalidity must be shown by clear and convincing evidence — *Microsoft Corp. v. i4i Ltd. P'ship*, 564 U.S. 91 (2011). Prima facie in a chart is not proof at trial.

### Step 7 (audit sub-mode)

For each row: is the mapping supported? Is the pin cite accurate? Is the element fully accounted for? What is the strongest counter? What is the rebuttal opportunity? Output verdicts per row (`supported` / `weak` / `unsupported`) and the chart's vulnerabilities.

## Patent-mode guardrails

- **Rule 11 / Patent Local Rule.** Infringement and invalidity contentions require a reasonable inquiry and a non-frivolous basis. A chart from this skill is a draft, not a contention.
- **Claim construction candor.** Every construction-dependent row states the construction assumed and the construction under which the mapping fails.
- **DOE candor.** A DOE mapping is not equivalent to a literal one. Flag prosecution history estoppel and dedication-to-the-public risks per element.
- **Indirect is separate.** Do not fold induced / contributory into direct-infringement rows.
- **Invalidity burden.** State the clear-and-convincing standard.

---

# MODE 2 — Civil Element Chart

Map the elements of a cause of action (or affirmative defense) against the evidence. The priority outputs are (a) a chart that links evidence to elements and (b) a gap list showing what is missing.

## Workflow

### Step 1: Identify the claim(s)

- What cause of action? (Or defense?) If multiple counts, chart each separately.
- Which side? Plaintiff's prima facie case, defendant's affirmative defense, defendant's challenge to plaintiff's prima facie case (MSJ mode). Plaintiff defaults to mapping the prima facie case (proving elements); defense defaults to mapping gaps and affirmative defenses (disproving or avoiding elements). Confirm the posture matches this matter.
- Which jurisdiction? State and court. **Elements and pattern-instruction language vary by jurisdiction.** The baseline elements below are a starting point; the controlling pattern instruction or statute controls. Default to **North Carolina** if not specified and flag the assumption.
- Which pleading? Work from the complaint / counterclaim / answer so the chart tracks the counts actually pleaded, not a generic version. If the attorney pastes or describes the pleading, use it; otherwise ask.

### Step 2: Load the elements

Three paths:

**(a) Baseline templates.** Use the element templates below for common causes of action and defenses, with citations to the Restatement / pattern instructions and jurisdiction caveats.

**(b) Custom.** The attorney defines elements, or pastes a jury instruction / statute / count to parse. Parse into numbered elements.

**(c) Affirmative defenses.** Map defenses — statute of limitations, laches, estoppel, waiver, unclean hands, release, accord and satisfaction, failure to mitigate, comparative fault, contributory negligence, assumption of risk, etc. Defenses have their own elements the defendant must prove (or, for some, the plaintiff must negate once raised).

**Jurisdiction-specific formulations — surface proactively.** If the matter is in Delaware, New York, or California (the three most common commercial fora), surface the state-specific formulation alongside the baseline without waiting to be asked. For North Carolina business law matters, apply NC pattern jury instructions (N.C.P.I. Civil) and flag where NC diverges from the Restatement baseline.

Key divergences (non-exhaustive):

| Cause of action / defense | Baseline (Restatement / pattern) | Jurisdiction-specific note |
|---|---|---|
| Breach of contract | 4 elements: contract, performance, breach, damages (CACI 303) | **NC:** same 4 elements; note that damages must be the natural and proximate result of the breach. **DE:** 3 elements — contractual obligation, breach, damages (causation folded in) per *VLIW Tech., LLC v. Hewlett-Packard Co.*, 840 A.2d 606 (Del. 2003). |
| Breach of contract — goods | Common-law breach elements | If goods + U.C.C. Article 2 (all 50 states except LA): load U.C.C. breach elements (conforming tender, acceptance/rejection/revocation, cure, cover, seller's remedies). |
| Breach of contract — installment | Common-law breach or U.C.C. § 2-711 | **Installment contracts under U.C.C. § 2-612** — "substantial impairment of the value of the installment" replaces the perfect-tender rule. If the contract calls for goods delivered in separate lots, default to § 2-612 framing and flag: "Confirm this characterization matches the contract's delivery structure." |
| Negligence | 4 elements: duty, breach, causation, damages (Restatement (Second) Torts § 281) | **NC:** apply NC pattern jury instructions (N.C.P.I. Civil) — confirm the applicable instruction number and negligence per se basis for the governing jurisdiction [verify]. **CA:** CACI No. 400. **NY:** PJI 2:10. |
| Negligent misrepresentation | Restatement (Second) Torts § 552 — justifiable reliance, pecuniary loss | **NY:** requires contemporaneous privity or a relationship "so close as to approach privity" per *Credit Alliance Corp. v. Arthur Andersen & Co.*, 65 N.Y.2d 536 (1985). |
| Fraud | 9 elements (often condensed to 5: representation, materiality, knowledge of falsity, intent to induce, justifiable reliance, damages) | **NC:** 5-element formulation; heightened pleading under N.C. R. Civ. P. 9(b). **DE:** 5 elements per *Stephenson v. Capano Dev.*, 462 A.2d 1069 (Del. 1983). **NY:** CPLR 3016(b) particularity; scienter is a distinct element. |
| Breach of fiduciary duty | Fiduciary duty, breach, damages | **NC:** same elements; fiduciary duty can arise from attorney-client, corporate officer/director, or other special-relationship contexts. **DE:** the most-developed fiduciary body of law — default to DE formulation for any DE-entity matter regardless of forum. |

When a jurisdiction-specific formulation differs materially from the baseline, open the chart with:

> **Jurisdiction note:** This is a [jurisdiction] matter. Here's how [jurisdiction]'s formulation differs from the baseline: [divergence]. The chart below uses the [jurisdiction] formulation. If that's wrong, say so and I'll reload.

Confirm the element list with the attorney before mapping. If the jurisdiction is not in the table above, ask: "Does your jurisdiction's pattern instruction add / drop / reword any of these?"

### Step 3: Map

For each element:

- **Evidence supporting** — what proves this element? Cite the source with a pin cite.
  - Deposition testimony — `[Doe Dep. 42:15–43:7]`
  - Declaration — `[Smith Decl. ¶ 12]`
  - Produced document — `[DEF00012345 at 3]`
  - Admission — `[Def.'s Resp. to RFA No. 5]`
  - Exhibit — `[Trial Ex. 14 at 2]`
  - Expert report — `[Jones Expert Rep. at 18]`
  - Discovery response — `[Pl.'s Resp. to Interrog. No. 8]`
  - Statute / case — for purely legal elements
- **Verbatim quote** where the evidence is testimonial or documentary. No paraphrase.
- **Evidence contradicting** — what cuts the other way? Cite it. This is the row's vulnerability.
- **Strength** — `strong` / `moderate` / `weak` / `none`. Over-calibrated scores are noise; `weak` and `none` are the rows that matter.
- **State per cell** — `supported` / `partial` / `disputed` / `gap` / `needs-discovery`.

### Step 4: Gap detection — the priority output

After mapping, produce a gap list:

> **Elements with thin or no evidence:** [list]
>
> - If asserting (plaintiff): these defeat your complaint's plausibility (Iqbal/Twombly), your MSJ opposition, or your case at trial. Close them before the next motion.
> - If defending: these are your MSJ targets and your directed-verdict motion. The plaintiff has to prove each element; a gap is a defense.
> - If pre-discovery: these are your discovery priorities — the depositions, document requests, and interrogatories that turn a gap into `supported` or confirm `none`.

Gap detection is not a conclusion about the merits. It is a map of where the case is light.

### Step 5: Phase-aware framing

Ask the phase. Same chart; different framing on the output:

- **Pre-filing / pleadings.** Does the complaint allege each element with plausibility (*Ashcroft v. Iqbal*, 556 U.S. 662 (2009); *Bell Atl. Corp. v. Twombly*, 550 U.S. 544 (2007))? Any element pleaded on information and belief without factual support is a 12(b)(6) target.
- **Discovery.** For each `gap` or `needs-discovery` element, what discovery is needed? Which witnesses, which custodians, which interrogatories, which RFAs.
- **MSJ.** For each element, is there a genuine dispute of material fact? A `supported` cell for the movant with no contradicting evidence is summary-judgment ammunition; a `disputed` cell is MSJ-defeating.
- **Trial.** Order of proof. Which witness proves element 1, which exhibit proves element 2, who authenticates, what is the foundation. The chart becomes the trial outline.

### Step 6 (audit sub-mode)

For an opposing party's MSJ brief, a motion to dismiss, or outside counsel's draft: for each element, does their cited evidence actually prove it? Where is their chart thin? What is your strongest counter?

## Civil-mode guardrails

- **Jurisdiction.** The element list is a baseline. Always confirm the controlling pattern instruction or statute. State the source in the chart's elements section.
- **Pleaded counts only.** Chart what is actually pleaded. Do not add a count the complaint does not allege just because the facts might support it.
- **Affirmative defenses.** If mapping defenses, note whether the burden is on the defendant (most) or whether raising the defense shifts a burden to the plaintiff.
- **"Gap" ≠ "case over."** A gap is a lead. Discovery, a declaration, or an expert report can close it.

---

# Shared rules (both modes)

## Output format

Present the chart in chat for the attorney to review and save in the app if they choose. If the attorney needs a file (e.g., to share with co-counsel), offer to format it for copy-paste into their preferred tool.

### Markdown table (always)

One table per claim / defense / patent-claim per target.

**Patent mode example:**

```
| [#] | Element (verbatim) | Accused feature | Evidence (pin-cited) | Mapping | State | Verified |
|---|---|---|---|---|---|---|
| 1a | "a processor configured to..." | SoC per datasheet | [Datasheet p. 7] "..." | literal-construction-dependent | mapped | ☐ |
| 1b | "means for [function]" (§112(f)) | [alleged equiv.] | [source] "..." | needs-evidence | needs-evidence | ☐ |
```

**Civil mode example:**

```
| [#] | Element | Evidence supporting (pin-cited) | Evidence contradicting | Strength | State | Verified |
|---|---|---|---|---|---|---|
| 1 | Existence of a contract | [Ex. 3, MSA § 1; Smith Dep. 22:4–14] | none | strong | supported | ☐ |
| 2 | Plaintiff's performance | [Jones Decl. ¶¶ 4–9] | [Doe Dep. 101:3–11: "they never delivered Phase 2"] | moderate | disputed | ☐ |
| 3 | Defendant's breach | — | [Doe Dep. 101:3–11] | none | gap | ☐ |
| 4 | Causation | — | — | none | needs-discovery | ☐ |
| 5 | Damages | [Expert Rep. at 18 — $2.4M lost profits] | [Def.'s Expert Rep. at 6 — critiques methodology] | moderate | disputed | ☐ |
```

Follow every chart with:
- **Defenses / thresholds** (patent mode: invalidity / indirect / willfulness flags; civil mode: affirmative-defense flags, Iqbal/Twombly flags pre-pleading)
- **Gap list** (civil) / **needs-evidence list** (patent) — the priority output
- **What cuts which way — summary** — strongest elements, weakest elements
- **Conclusion line** — *"This skill does not conclude."* Elements mapped/supported: [list]. Elements needing evidence / in a gap state: [list]. Elements construction-dependent (patent) / disputed (civil): [list]. Attorney judgment required.
- **Citation verification reminder** — every pin cite, case, deposition page:line must be verified against the source. If a cite cannot be produced from available materials, the cell is `needs-evidence` or `gap`.

## Summary readout

After the chart is produced, give a one-screen readout:

- Claim(s) / count(s) / patent claim(s), target(s), jurisdiction, phase
- Elements charted · supported/mapped · partial · disputed · gap/needs-evidence · not-found
- The gap list (civil) or needs-evidence list (patent)
- Reminder: every cell is a lead. The chart is a draft, not a contention / brief / order of proof.

## Spreadsheet safety note

If the attorney asks to copy chart content into a spreadsheet: any verbatim evidence from adversarial sources (opposing counsel's contentions, product manuals, prior art, deposition transcripts) can contain strings that spreadsheet software will execute as formulas (e.g., `=HYPERLINK(...)`). Before pasting, prepend a single apostrophe (`'`) to any cell value that begins with `=`, `+`, `-`, `@`, tab, or carriage return. Note which cells were neutralized so the reviewer can see which quotes were modified.

## Privilege and confidentiality

This chart is derived from source documents that may be privileged, confidential, or both. It inherits the sources' privilege and confidentiality status — distribution beyond the privilege circle can waive privilege. Store with the matter's privileged files and make distribution decisions deliberately. Nothing in this chart has been filed or served; it is a draft for attorney review.

---

## Shared guardrails — checklist

- **Citation verification.** Every pin cite is a claim about the source. The attorney verifies. Do not fabricate cites — if a cite cannot be produced from available materials, the cell is `needs-evidence` or `gap`.
- **Source attribution.** Every verbatim quote has its source noted. A quote without a source is not evidence.
- **No silent supplement.** Thin evidence means `needs-evidence` / `gap`, not extrapolation from web search, training data, or "how these cases usually go." Use `web_search` only to locate publicly available reference material (a patent, a product page, a court opinion) — never to fill a factual gap in the chart.
- **Decision posture.** When uncertain whether an element is met, flag; do not decide. `partial` tells the attorney what part is missing.
- **Elements are jurisdiction-specific.** The templates above are a baseline. The controlling pattern instruction or statute controls.
- **A chart is not a brief, a filing, or a contention.** Every output is a draft.

---

## What this skill does not do

- **It does not conclude.** Not infringement, not non-infringement, not liability, not non-liability. Ever.
- **It does not decide claim construction** (patent) or **the controlling elements** (civil). It flags disputed terms / baseline elements and charts under stated assumptions.
- **It does not meet the clear-and-convincing burden for invalidity** or **the preponderance at trial**. It produces a prima facie draft for attorney review.
- **It does not substitute for expert analysis.** Source code review, teardowns, technical experts, damages experts are separate work products this chart routes to, not replaces.
- **It does not serve, file, or sign anything.** Every output is a draft. The attorney serves and files.
- **It does not extrapolate.** If the evidence is not there, the cell is `needs-evidence` / `gap` — never a guess.
- **It does not access Westlaw, Lexis, CoCounsel, CourtListener, or other legal research databases directly.** Use `web_search` and any documents or sources the attorney provides, and note the limits.

---

## Next steps

After producing the chart, offer the attorney a branching next step:

1. **Dig into a gap** — draft discovery requests, depo topics, or an RFA set targeting the weakest elements.
2. **Draft a section** — use the chart to draft an MSJ brief section, a complaint paragraph, or an order-of-proof outline.
3. **Rerun with more evidence** — if the attorney can provide additional documents, testimony, or expert reports, rerun the mapping.
4. **Audit the other side's chart** — switch to audit mode and stress-test opposing counsel's contentions.
5. **Something else** — the attorney directs.
