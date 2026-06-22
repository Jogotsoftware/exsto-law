---
slug: litigation.subpoena-triage
name: Subpoena Triage
practice_area: litigation
description: Classify an inbound subpoena or Civil Investigative Demand, analyze scope/burden/privilege, build an objections framework, and produce a compliance plan with deadline calendar.
when_to_use: Attorney says "we got a subpoena," shares a subpoena document or text, mentions a CID or third-party document request, or asks how to respond to a subpoena served on the firm or a client.
user_invocable: true
---

# Subpoena Triage

## Purpose

Subpoenas arrive with deadlines. The failure modes: missing the deadline, over-producing (privilege waiver, burden we should have objected to), under-producing (contempt exposure), or missing a motion-to-quash window. Work through this skill whenever a subpoena or Civil Investigative Demand is served on the firm, a client, or a matter you are handling.

Every output here is a **draft for attorney review** — it is not a legal opinion and it is not ready to send to an issuing court or agency. The attorney owns every legal conclusion, every objection, and every decision about whether and how to respond.

---

## Jurisdiction assumption

Default forum is **North Carolina state court** and **federal courts in the Eastern, Middle, or Western Districts of North Carolina** unless the subpoena specifies otherwise. Subpoena practice varies materially: federal (FRCP 45) vs. NC Rules of Civil Procedure Rule 45, local rules, standing orders, and subpoena type (trial / deposition / document production) all change objection deadlines, place-of-compliance limits, privilege-log requirements, and cost-shifting. Surface the assumed forum at the top of every output; correct it if the attorney specifies a different one.

---

## How to use this skill

**If a matter or client is already in context,** ground your analysis in it — use the known caption, parties, and any documents already shared.

**If no matter is in context,** ask: "Which matter or client is this subpoena connected to, or is this a standalone third-party request?" One short question, then proceed.

**If the attorney provides the subpoena text or a document,** work from that. If they describe it verbally, ask for the key fields (issuing authority, case caption, response deadline, document categories sought) before proceeding.

**For legal research,** use `web_search` and any sources or documents the attorney provides. Tag every rule reference, case, statute, and regulation with its source: `[web search — verify]` for anything found via search, `[model knowledge — verify]` for anything recalled from training data, `[user provided]` for anything the attorney supplied. Citations tagged `verify` carry higher fabrication risk and should be checked against a primary source (Westlaw, CourtListener, NC Courts, or equivalent) before asserting in objections or filings.

**No silent supplement.** If a search returns thin or no results for the specific forum rule, variant, or pinpoint, report what was found and stop. Say: "My search returned [N] results for [rule/forum/variant]. Coverage appears thin. Options: (1) broaden the search query, (2) you provide the rule text, (3) I continue with model knowledge tagged `[model knowledge — verify]` which you should check before relying, or (4) stop here. Which would you like?" The attorney decides whether to accept lower-confidence sources.

---

## Step 0: Research the applicable rule

Before analyzing the subpoena, identify and cite the operative rule of civil procedure for the forum and subpoena type. For each rule confirm:

- Place-of-compliance limits (who can be compelled, from where)
- Objection deadline — note that it often runs from the **earlier of** the compliance date or a fixed number of days after service; do not default to a single number without checking
- Privilege-log requirements (format, required fields)
- Cost-shifting availability for third-party responders

Cite with pinpoint references and tag each citation. Flag if you cannot find a reliable pinpoint — do not invent one.

**Grand jury subpoena:** If the subpoena is from a grand jury, stop immediately. Flag it for escalation to criminal defense counsel. Do not proceed with standard triage. Grand jury subpoenas are outside this skill's scope.

---

## Step 1: Classify

Identify which type of subpoena this is — the rules and response posture differ by type:

- **Third-party document subpoena (civil)** — the firm or client is not a party to the underlying litigation; someone wants documents. Objection categories: relevance, burden, privilege, place-of-compliance / geographic reach.
- **Third-party deposition subpoena** — someone wants an employee or the firm's client to testify. Scope, relevance, burden; possible motion to quash; witness prep will be required.
- **Party subpoena** — the firm's client is a party; this is discovery in a matter already being tracked. Treat as discovery, not a standalone inbound.
- **Regulatory Civil Investigative Demand (CID)** — FTC, SEC, DOJ, NC Attorney General, or another agency. Different rules and posture than civil subpoenas; often more deferential but also more consequential. Recommend outside regulatory counsel.
- **Grand jury subpoena** — escalate immediately; stop here.

---

## Step 2: Extract key fields

Pull these from the subpoena document or the attorney's description:

- **Issuing authority** — court (which court, which district), agency (which agency), or issuing counsel (if civil)
- **Issuing party** — who requested it (if civil)
- **Case / matter caption** — the underlying litigation the subpoena relates to
- **Document categories sought** — numbered list, verbatim from the subpoena
- **Testimony topics** (if deposition) — Rule 30(b)(6) designations if any
- **Date served** — the date service was effected
- **Response / objection deadline** — compute from date served per the applicable rule researched in Step 0
- **Production date** — date by which documents must be produced if no objections succeed
- **Geographic scope** — custodians, office locations, systems implicated
- **Custodian of record / signatory** — who at the firm or client would sign the response

---

## Step 3: Matter cross-check

- **Party subpoena → does the caption match an existing matter?** If yes, route the analysis to that matter's workflow; this triage is informational context for it.
- **Third-party subpoena → caption not recognized?** Capture the parties and log it as a standalone inbound. Ask whether to open a new matter to track response.
- **Multiple subpoenas from the same underlying case?** Flag coordinated issuance — a single response strategy may apply across them.

Apply the firm's positions on matter-tracking thresholds if the attorney has stated them. If no position has been given, default to: open a matter for tracking any subpoena that requires more than a simple no-documents-responsive response.

---

## Step 4: Analyze scope, burden, and privilege

### Scope / relevance

- Do the document categories map to records the firm or client plausibly holds?
- Is any category overbroad, a fishing expedition, or untethered to the claims or defenses in the underlying case?
- Does geographic or custodian scope exceed what the applicable rule allows?

### Burden

- Custodians implicated, systems to search, time period covered
- Estimated volume: small / medium / large / extreme (with reasoning)
- Cost-shifting availability for third-party responders — flag if applicable

### Privilege

Privilege scoping is a first-pass read. The final call is always the attorney's.

- Attorney-client privilege or work product likely implicated? (Presumptively yes for any communication involving counsel; yes for any document prepared in anticipation of litigation.)
- Other privileges: trade secret, common-interest, HIPAA (if health records), NC state law privileges
- A privilege log will almost certainly be required — note the format and fields required under the applicable rule

### Other objection grounds

- **Confidentiality** — third-party confidential business information; protective order may be needed
- **Duplicative** — does the issuing party already have these documents from another source?
- **Not possessed** — the firm or client does not hold what is being requested (document with specificity)
- **Improper service** — check the applicable rule's service requirements

---

## Step 5: Objections framework

Draft a structured outline of applicable objections — not a final objections letter, but the skeleton the attorney and any outside counsel will use to draft one.

For each objection provide:
- Legal basis — cite the pinpoint from the rule researched in Step 0, with source tag
- Specific application to this subpoena (which categories, which custodians)
- Strength: strong / reasonable / weak
- Flag with `[SME VERIFY]` — every objection row must be verified by the attorney before asserting in writing

Present as a table:

| Objection | Legal basis | Applies to | Strength | Attorney verified? |
|---|---|---|---|---|
| Relevance | [rule + pinpoint] `[source tag]` | [categories] | [strong/reasonable/weak] | [ ] |
| Burden | [rule + pinpoint] `[source tag]` | [categories] | | [ ] |
| Attorney-client / work product privilege | [rule + pinpoint] `[source tag]` | [all responsive docs] | strong (almost always) | [ ] |
| Duplicative | [rule/doctrine] `[source tag]` | [if applicable] | | [ ] |
| [other objection] | | | | [ ] |

---

## Step 6: Compliance plan

Even when objecting, the firm typically produces some responsive documents. Draft a plan for the production that would occur if objections partially succeed or are narrowed:

- **Scope of likely production** — what would be produced after objections narrow the request
- **Custodians to search** — names and systems
- **Date range**
- **Review protocol** — who reviews for privilege (firm attorneys, outside counsel, contract reviewers); estimated volume to review
- **Production format** — per the subpoena's specifications or a negotiated protocol (native, PDF, TIFF + load file)
- **Privilege log** — required fields, format, estimated entries

---

## Step 7: Deadline calendar

Use the deadlines identified in Step 0. Present every date clearly; flag any that require immediate action.

Note: **objection deadlines often run from the earlier of the compliance date or a fixed number of days after service** — do not assume a single deadline without checking the applicable rule and any local variants. Mark all deadline rows with `[SME VERIFY]` until the attorney confirms the computation.

- **Response / objection deadline** — [date] `[SME VERIFY]`
- **Meet-and-confer deadline** — [date, typically before the objection deadline] `[SME VERIFY]`
- **Production date** — [date, if no objections succeed] `[SME VERIFY]`
- **Motion-to-quash window** — [date range, if pursuing that path — timing is critical] `[SME VERIFY]`

Immediate action: calendar all of these now.

---

## Step 8: Triage output

Present the full analysis in chat for the attorney to review. Use this structure:

---

> **DRAFT — ATTORNEY REVIEW REQUIRED.**
> This is a structured classification and scoping read to support fast decisions on deadlines, holds, and engagement. It is not a substitute for legal judgment. Every rule reference is a starting-point heuristic; jurisdiction-specific analysis, finalization of objections, motions practice, and privilege calls require the attorney's review. For any subpoena above routine third-party document scope, consider engaging outside counsel familiar with the forum.

**Served:** [YYYY-MM-DD]
**Served on:** [firm / client / entity name]
**Classification:** [third-party-docs / third-party-depo / party / CID / grand-jury]
**Forum:** [court or agency — confirmed or assumed]

---

### Key fields

- **Issuing authority:** [court / agency]
- **Issuing party:** [name]
- **Case caption:** [caption]
- **Response / objection deadline:** [date] `[SME VERIFY]`
- **Production date:** [date] `[SME VERIFY]`
- **Motion-to-quash window:** [date range] `[SME VERIFY]`

### Document categories sought

[numbered list, concise, verbatim or summarized from subpoena]

### Custodians / systems likely implicated

[list]

---

### Matter cross-check

**Related matter:** [matter name/ID or "none identified"]
**Disposition:** [routed to existing matter / standalone inbound / new matter recommended]

---

### Scope and burden analysis

**Scope:** [relevance assessment, by category]
**Burden estimate:** [small / medium / large / extreme — with reasoning]
**Geographic reach issues:** [any]

### Privilege analysis

*First-pass read only — final call is the attorney's.*

**Attorney-client / work product likely implicated:** [yes / no + which categories] `[SME VERIFY]`
**Other privileges:** [trade secret, HIPAA, state, common interest — if applicable] `[SME VERIFY]`
**Privilege log format required:** [per applicable rule — cite with source tag] `[SME VERIFY]`

---

### Objections framework

[table from Step 5]

---

### Compliance plan

[plan from Step 6]

---

### Deadline calendar

[dates from Step 7]

---

### Immediate action items

- [ ] Legal hold: issue or confirm one is in place covering the subpoena's scope
- [ ] Outside counsel: engaged / not yet / recommended
- [ ] Meet-and-confer: schedule before objection deadline
- [ ] Matter tracking: open a matter or confirm existing matter is updated
- [ ] Insurance / cost-shifting analysis: [flag if burden is large or if coverage may apply]
- [ ] Internal escalation: [who needs to know]

---

### Recommendation

[Two short paragraphs: proposed objection posture and production posture; whether outside counsel should handle the response; whether to consider a motion to quash. Flag any decision the attorney needs to make before the response window closes.]

---

### Citation verification notice

Every rule reference, case, statute, and regulation in this output is AI-generated. Source tags show origin — `[web search — verify]` and `[model knowledge — verify]` tags carry higher fabrication risk. Before asserting any citation in correspondence with the issuing party, in objections, or in a motion to quash, verify against a primary source (Westlaw, CourtListener, NC Courts, or equivalent). Fabricated citations in filed documents have resulted in sanctions.

---

## Step 9: Hand off

After presenting the triage output, offer next steps:

1. **Draft the objections letter** — based on the framework above (attorney finalizes before sending)
2. **Flag the legal hold** — if one is not already in place, the attorney should issue one covering the subpoena scope
3. **Open or update a matter** — to track response workflow and deadlines
4. **Escalate to outside counsel** — recommended for anything beyond a simple third-party document response, and required for any CID or motion-to-quash scenario
5. **Something else** — the attorney directs

**Gate before responding to the issuing party:** Before serving objections, producing documents, appearing for deposition, or filing a motion to quash, the attorney must review and approve the response. Present the output in chat; do not transmit anything to the issuing authority.

**CID:** Flag that regulator-specific norms apply (often less adversarial but higher-stakes). Recommend outside regulatory counsel before responding.

**Grand jury:** If classified as grand jury at any point, stop. Flag for criminal defense counsel escalation. Do not proceed.

---

## What this skill does not do

- **Draft the final objections letter.** Produces the framework; the letter is the attorney's work product.
- **File a motion to quash.** Surfaces the option and timing; the motion requires jurisdiction-specific analysis and the attorney's signature.
- **Independently verify rule currency or local variants.** The Step 0 research produces a starting-point rule cite; the attorney should verify currency and local variants before acting.
- **Handle grand jury subpoenas.** Escalates immediately; this is outside triage scope.
- **Access external legal research platforms** (Westlaw, LexisNexis, CourtListener, etc.) directly. Uses `web_search` and attorney-provided sources; results are tagged accordingly and must be verified before relying.
