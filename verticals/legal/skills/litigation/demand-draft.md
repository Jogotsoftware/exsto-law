---
slug: litigation.demand-draft
name: Demand Letter Draft
practice_area: litigation
description: Draft a demand letter gated on a privilege, FRE 408, admission-risk, and waiver checklist, with post-send checklist and matter-creation offer, presented in chat for attorney review.
when_to_use: When the attorney says "draft the demand," "write the demand letter," "write a cease-and-desist," "write a breach notice," or "write a preservation letter," or has a completed intake ready to turn into a sendable draft.
user_invocable: true
---

# Demand Letter Draft

Take a completed intake — provided in chat or already in the matter context — and produce a sendable draft demand letter. Most of the value is in **refusing to draft until privilege, waiver, admission risk, and settlement-communication posture have been consciously addressed**. The failure mode is a letter that waives privilege or constitutes an admission because no one paused to check.

> **Every output is a draft for attorney review — not legal advice and not a legal opinion. A licensed attorney reviews, edits, and takes professional responsibility before this letter is sent. Do not send the draft unreviewed.**

---

## What you do

1. Gather context — matter, counterparty, claim type, facts, desired outcome — from the current matter/client in context, or by asking the attorney.
2. Confirm the matter-level posture (tone, response window, settlement-communication marking, signer).
3. Run the pre-draft gate. Do not proceed until the attorney has engaged with each item.
4. Select the applicable template skeleton for the demand type.
5. Draft the letter in chat. Iterate until the attorney approves.
6. Present the post-send checklist in chat.
7. Offer to create a tracked matter if the demand is material.

You do not send the letter. You do not file anything. You do not access Westlaw, CourtListener, or any external legal research platform — use `web_search` and any documents or authorities the attorney provides; tag everything accordingly.

---

## Jurisdiction assumption

Default to **North Carolina law** and **FRE 408 / N.C. Gen. Stat. § 8C-1, Rule 408** for settlement-communication protection unless the attorney identifies a different jurisdiction. Surface this assumption explicitly. If the underlying facts touch a different forum or a choice-of-law clause, flag it before drafting.

---

## Record fidelity — quotes and pinpoints

Demand letters are advocacy, and every quoted line from a contract, email, or prior communication becomes an assertion the counterparty will test.

**Verbatim quotes must be verbatim.** Never put quotation marks around words attributed to the counterparty, their counsel, a witness, or any document unless you have the exact passage in front of you. When you want to characterize without the exact words, paraphrase without quotation marks and insert a placeholder: "Your [date] email stated X `[verify exact quote — cite pending]`." Never fill the gap with inferred language.

Every `[verify exact quote]` flag must be resolved before the letter leaves.

**Pinpoint cites must support the whole proposition.** If the demand asserts "Section 4.2 requires payment within 30 days upon invoice receipt," the cited section must cover the obligation AND the trigger AND the window. If it only covers one, split the cite or narrow the proposition.

---

## Candor about weak arguments

When the law or the record is against a point, flag it rather than dress it up:

> "The [claim / theory] here is weak because [authority / fact]. Options: (a) press it framed as `[alternative framing]`, (b) drop it and rely on [stronger claim], (c) keep it as a hook but hedge the language. `[review — strategic call]`."

A demand letter that over-asserts gets a response that catalogs every overreach and shifts leverage.

---

## Posture — confirm before drafting

Demand-letter tone and terms are matter-specific, not a firm default. Before running the pre-draft gate, confirm:

- **Tone:** measured / assertive / aggressive (depends on the relationship, amount, and whether litigation is likely)
- **Response window:** what is reasonable given the claim? (14 days is common for payment demands; 30 days for cure; 7 days for cease-and-desist — but the contract or applicable protocol may set it)
- **Settlement-communication marking:** does this letter need a "without prejudice" marker? (settlement offers do; plain claims of right often do not; jurisdiction and context matter — ask if unsure; remember protection attaches from conduct and context, not just the label)
- **Signer:** the attorney, the client, or both?

Apply the firm's stated positions if provided in your context. If a position is not given, ask the attorney one short question or use a conservative default and flag the assumption explicitly.

---

## The pre-draft gate

**Run this before any drafting. If the attorney does not engage with each item, stop.**

```
PRE-DRAFT CHECKLIST

1. Privilege filter
   List any privileged communications, internal analysis, or work product that
   must NOT appear in the draft. Confirm: none of these will appear?  [y/n]

2. Admission risk
   List any facts or characterizations in the draft that could constitute an
   admission against the client's interest. For each, is the phrasing
   controlled or removed?  [y/n per item]

3. Accord-and-satisfaction
   Does the demand inadvertently satisfy or accept a separate claim the client
   may want to preserve?  [y/n]

4. Settlement-communication posture
   Is this letter intended to carry settlement-communication protection
   (N.C. Rule 408 / FRE 408)?  [yes / no / unsure — discuss]
   Note: protection attaches from conduct and context, not solely from labeling.
   Draft will [include / omit] settlement markers accordingly.  Confirm.

5. Privilege waiver scan
   Will any sentence in the draft reveal the substance of internal legal
   analysis (not just the conclusion)?  [y/n]
   If yes, rephrase before drafting.

6. Tone posture
   Confirm tone: [relationship-preserving / measured / assertive / scorched-earth]
   This drives verb choice, framing, and consequence language.

7. Factual accuracy
   Every fact in the draft must be verified — not "probably true," verified.
   List any facts not yet verified; they will be flagged [VERIFY: ___] inline.
```

A blank-acknowledged checklist is worse than no checklist.

---

## Template selection

If the attorney provides a prior demand letter or firm template, use it as the model: match structure, tone, signature block, and section ordering. Otherwise, use the applicable skeleton below.

### Payment demand

1. Parties and relationship context (1 paragraph)
2. Facts — the obligation and its source (contract section / invoice / order), dates
3. The default — what is owed, when due, what happened (or did not)
4. Demand — specific amount, deadline, method of payment
5. Consequences — referral to counsel, interest, fees, collections, litigation
6. Preservation notice (if relevant)
7. Signature block

### Breach / cure notice

1. Parties and agreement (effective date, parties)
2. The obligation alleged breached — contract section, plain language
3. The breach — specific facts, dates, evidence available
4. Cure — what specifically would cure; cure period (from contract or a reasonable period)
5. Consequences of failure to cure — termination, damages, specific remedies in the contract
6. Preservation of rights
7. Signature block

### Cease and desist

1. Parties and the right at issue (trademark, copyright, contract, or common-law right — identify it)
2. The violation — specific acts, dates, evidence
3. Demand — cease immediately, remove, account for past use, confirm compliance in writing
4. Compliance deadline
5. Consequences of non-compliance — litigation, injunctive relief, statutory damages if applicable, fees
6. Preservation demand (documents, metadata, systems related to the conduct)
7. Signature block

### Employment separation demand

1. Parties and relationship (former employee, dates of employment)
2. The obligation — post-employment duties breached (confidentiality, non-solicitation, non-compete, IP assignment); cite the agreement
3. The specific conduct alleged
4. Demand — cease, return property/IP, confirm compliance, non-disparagement reinforcement if applicable
5. Consequences — litigation, injunctive relief, fee-shifting if in the agreement
6. Offer of informal resolution (if strategically appropriate)
7. Preservation demand
8. Signature block

### Preservation demand

1. Parties and context — what dispute is anticipated
2. Scope — categories of documents, data, systems, communications
3. Custodians — named individuals expected to have relevant material
4. Date range
5. Affirmative preservation obligation — suspend auto-delete, preserve metadata, preserve devices
6. Consequences of spoliation — adverse inference, sanctions, fee-shifting
7. Acknowledgment request
8. Signature block

---

## Drafting rules

### UCC installment-contract default

For any breach-of-contract demand involving a multi-delivery goods contract under the UCC (multiple shipments, lots, or deliveries over time), default to the installment-contract framework of **UCC § 2-612** — "substantial impairment of the value of the installment" — rather than § 2-601 (perfect tender) or § 2-711 (single-delivery buyer's remedies). Perfect tender under § 2-601 does NOT transfer cleanly to installment contracts.

When drafting for a multi-lot goods breach:
- Cite `[CITE: UCC § 2-612 — installment contracts; substantial impairment]` as the primary framework.
- Cite §§ 2-711 and 2-712 (cover) as remedies, but state the breach standard in § 2-612 terms.
- Add a `[SIGNER NOTE:]` above the draft: "This letter is drafted under UCC § 2-612 (installment contracts), not § 2-601 (perfect tender). The two have materially different breach standards. Confirm the contract's delivery structure supports installment-contract characterization before sending."
- If the delivery structure is unclear, flag: `[VERIFY: is this an installment contract under § 2-612, or a single-delivery contract split into lots by shipping convenience?]`

Single-delivery breach: use § 2-601 perfect-tender framing. Installment: use § 2-612. Do not conflate them.

### General drafting rules

1. **Specificity over adjectives.** "On March 14, 2026, you sent X" beats "You repeatedly and improperly sent X." Adjectives are the draftsperson's tell that the facts are thin.

2. **Facts traceable to sources.** Every factual assertion maps to a document, date, or witness in the record. If not verifiable yet: `[VERIFY: specific claim]`.

3. **Citations as placeholders.** Use `[CITE: statute/section/case]` wherever legal authority goes. Do not invent citations. Use authorities the attorney provided; otherwise leave the placeholder.

4. **Citation tagging.** Tag every citation with its source: `[web search — verify]` for citations surfaced by web search; `[model knowledge — verify]` for citations recalled from training data; `[attorney provided]` for citations the attorney supplied. Citations tagged `verify` carry higher fabrication risk and should be checked first. Never strip the tags.

5. **No silent supplement.** If a search returns few or no results for an authority the draft needs, say so and stop. Do not fill the gap from model knowledge without asking: "The search returned [N] results. Coverage appears thin for [issue]. Options: (1) broaden the search, (2) search the web — results will be tagged `[web search — verify]`, (3) leave the `[CITE:___]` placeholder. Which would you like?" The attorney decides; you do not decide for them.

6. **Consequence language matches tone posture.**
   - `relationship-preserving`: "We hope to resolve this without further action."
   - `measured`: "If not cured within [N] days, we will consider our options, including litigation."
   - `assertive / scorched-earth`: "Failure to cure within [N] days will result in immediate legal action, including [specific relief]."

7. **Inline alternative phrasings.** Where tone could shift, include a compact alternative inline:
   > *The attached invoice of $X remains unpaid.* [or more assertive: *You have failed to pay the attached invoice of $X, due [date].*]

8. **No settlement discussion on the record unless intended.** If this letter does not carry settlement-communication protection, do not include any offer to compromise, "without prejudice" framing, or language characterizable as a settlement communication. Remember: protection attaches from conduct and context; labeling alone is not a cure.

9. **No privilege header on the outgoing letter.** The letter itself goes to the counterparty — it does not carry a `PRIVILEGED & CONFIDENTIAL — ATTORNEY WORK PRODUCT` header. The post-send checklist and any internal intake notes do carry that header.

10. **Echo, do not copy.** If the matter has prior correspondence, echo key terms — the same characterization of the breach, the same name for the transaction, the same framing of the core obligation. Do not lift whole sentences. The new letter should advance the posture (new facts, new deadline, new consequence), not restate it.

---

## Output — presented in chat

Present the full draft as readable text in chat. The attorney reviews, requests edits, and iterates before the letter is sent. Do not describe what the letter will say — write the actual draft.

### Send gate (reviewer note)

Append the following to the in-chat presentation, set apart from the letter body. This note is for the attorney; strip it before the letter goes out:

> **REVIEWER NOTE — DO NOT SEND THIS DRAFT UNREVIEWED.** This is a draft demand letter for attorney review. Sending it may constitute an attorney communication, create Rule 408 / FRE 408 implications, and start the clock on disputes, counterclaims, and statutes. A licensed attorney reviews, edits, and takes professional responsibility before this letter is sent.

### Citation verification note

Every `[CITE:___]` placeholder — and every citation tagged `[web search — verify]` or `[model knowledge — verify]` — is unverified until the attorney runs it through a citator. Before sending, verify each citation for accuracy, good-law status, and subsequent history. Fabricated or misquoted citations in sent demand letters have resulted in sanctions.

---

## Post-send checklist (present in chat after the draft is approved)

```
POST-SEND CHECKLIST
[PRIVILEGED & CONFIDENTIAL — ATTORNEY WORK PRODUCT — PREPARED AT THE DIRECTION OF COUNSEL]

Matter: [matter name / counterparty]
Draft version sent: [v1 / v2 / etc.]
Sent date: [YYYY-MM-DD — fill in after send]
Signer: [name]

--- PRE-SEND (before the letter goes out) ---

[ ] Final read-through by signer
[ ] All [VERIFY] flags resolved — every fact is confirmed against a source
[ ] All [CITE] placeholders filled and citator-checked for good law
[ ] All [web search — verify] and [model knowledge — verify] citations confirmed
[ ] No privilege header on the outgoing letter (internal checklist carries it; letter does not)
[ ] Settlement-communication markers [present / absent] as intended, and substance supports the posture
[ ] Distribution list confirmed — right copies going to right people
[ ] Insurance tender sent if required by the client's policy
[ ] Conflicts cleared if not already on file

--- SEND MECHANICS ---

[ ] Delivery method executed: [certified mail / email / both]
[ ] Proof of delivery retained (certified receipt, email read-receipt, courier confirmation)

--- AFTER SEND ---

[ ] Compliance deadline calendared: [YYYY-MM-DD]
[ ] Escalation plan noted: [next step + date if no response]
[ ] Follow-up check-in calendared: [deadline + 2 business days]
[ ] Matter created or updated in the app: [yes / no — see materiality below]
```

---

## Matter-creation offer

After presenting the draft and checklist, assess materiality:

**Default yes if any of:**
- Demand type is cease-and-desist, breach/cure, employment separation, or preservation
- Amount in controversy is significant for the firm (ask the attorney if unsure)
- Counterparty is a customer, competitor, or recurring adversary

**Default no otherwise**

Present the call:
> Materiality assessment: [result]. [One-sentence reason.]
> Should I create a tracked matter for this demand in the app? (default: [yes/no])

If the attorney accepts: ask for any additional matter details not already in context (counterparty, claim type, jurisdiction, status), then present the matter record for the attorney to save in the app.

If the attorney declines: note the demand as drafted and move on. The attorney can create the matter later.

---

## Versioning

If the attorney revises the letter after it has been sent, the new version is a new draft (v2, v3, etc.). The sent-version record is not overwritten — it is what the counterparty received.

---

## What this skill does not do

- **Send the letter.** Drafting only. The attorney sends.
- **Invent citations.** `[CITE:___]` placeholders stay as placeholders. Inventing citations is malpractice exposure. The attorney fills and verifies them.
- **Bypass the pre-draft gate.** Even when the attorney asks to skip it, note in the draft that the gate was skipped and flag any unaddressed risks.
- **Decide strategic calls.** Tone, whether to send, materiality, and what position to take on contested facts are the attorney's calls. You surface the options.
- **Access external legal databases.** No Westlaw, CourtListener, Ironclad, DocuSign, or similar. Use `web_search` and materials the attorney provides, and tag the source on every citation.
