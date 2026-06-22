---
slug: ip.cease-desist
name: Intellectual Property Cease and Desist — Draft or Triage
practice_area: ip
description: Draft an outgoing cease-and-desist letter calibrated to the firm's enforcement posture, or triage an incoming one into a structured options memo with a recommendation.
when_to_use: When the attorney wants to send a cease-and-desist letter asserting an IP right, or when the attorney has received a cease-and-desist letter and needs it triaged into options.
user_invocable: true
---

# Intellectual Property Cease and Desist — Draft or Triage

Two modes. If the attorney does not specify, ask once:

> Are we **sending** a cease-and-desist (asserting your rights) or **triaging one you received** (defending)?

- **Send mode** — draft a C&D letter calibrated to the firm's enforcement posture; a loud gate runs before the draft is presented.
- **Receive mode** — read an incoming C&D and produce a structured options memo with a recommendation.

> **Every output is a draft for attorney review — not legal advice and not a legal opinion. The attorney owns the legal conclusion, reviews all output, and decides what is sent, filed, or acted upon.**

**Privilege and destination check.** The outgoing C&D letter itself is not privileged — it is sent to the counterparty. Internal drafts, pre-send briefs, and the receive-mode triage memo are attorney work product. Do not present those as ready to share with the counterparty or outside the privilege circle. Do not ask the attorney to paste privileged content (e.g., litigation strategy, prior triage memos) into a context visible to others.

**Jurisdiction assumption.** Trademark rights are territorial; copyright enforcement is jurisdiction-specific and US statutory damages (17 U.S.C. §504) turn on registration timing. This skill defaults to North Carolina / United States law and the USPTO registration footprint unless the attorney specifies otherwise. If the infringing conduct, counterparty, or likely forum is somewhere else, flag it — the draft may not apply as written and may need review by a foreign associate.

**Matter context.** If a matter or client is active in your context, ground all output in it. If no matter is in context and this work seems tied to a specific client or file, ask which matter this is for before drafting.

---

## Send Mode — Drafting the Cease and Desist Letter

### Step 1: Identify the Right

Ask in one batch:

> Which IP right are we asserting?
>
> - **Trademark** — registered or common-law only? If registered: USPTO reg number and class(es)? If common-law: first-use date and geographic scope?
> - **Copyright** — registered with the Copyright Office? Title, registration number, date? If unregistered: note that US suits require registration to file, and statutory damages/fees require pre-infringement registration.
> - **Both** — identify each separately.

Record each right. Registered rights are cited by number. Common-law trademark rights get a first-use evidence paragraph. Unregistered copyrights get a flag:

> We may not be able to file suit on an unregistered US copyright without registering first. Verify before the letter threatens litigation — `[SME VERIFY]`.

### Step 2: Identify the Conduct

Ask:

> Describe the infringing conduct specifically — adjectives are a tell that the facts are thin:
>
> - **Who** — entity name, individual, platform handle?
> - **What** — the accused mark, the accused copy, the accused product? Attach or describe samples.
> - **Where** — website URL, marketplace listing, physical retail, social media?
> - **Since when** — date first observed, earliest documented use?
> - **Evidence** — screenshots, receipts, watch-service hit, customer confusion reports?

"You sold product X on [URL] bearing the mark [Y] on [date]" beats "you have been infringing our rights."

### Step 3: Identify the Relationship

Ask:

> What is the relationship between the firm's client and the recipient?
>
> - **Competitor** (direct or adjacent) — standard posture applies
> - **Reseller / channel partner** — tone adjusts; consider a soft-letter path
> - **Former licensee / ex-employee / former partner** — contract provisions likely apply; cite them
> - **Stranger / random infringer** — standard
> - **Current customer or business partner** — flag before drafting; this is a sensitive relationship that may warrant escalation

This changes tone, approver, and whether to draft at all before escalating.

### Step 4: Identify the Demand

Ask:

> What does the client actually want?
>
> - **Stop** — cease the infringing use
> - **Account** — report sales, profits, volumes (damages baseline)
> - **Destroy** — destroy or recall infringing inventory
> - **Damages** — monetary settlement
> - **Transfer / assign** — domain, social account, or accused mark/copyright
> - **Public correction** — takedown, public statement
> - **Confirm in writing** — compliance undertaking by a stated date

The demand must be proportionate to the harm. An overbroad demand is evidence of bad faith if the matter is ever litigated.

**Marketplace parallel path.** If the accused conduct is on a marketplace (Amazon, Etsy, eBay, Alibaba, TikTok Shop, Shopify-hosted storefronts), flag the platform's brand-protection / IP-infringement reporting path as a faster, cheaper parallel track that does not require a C&D or litigation:

- **Amazon Brand Registry** — trademark and copyright takedown, counterfeit removal
- **Etsy IP Infringement reporting** — trademark / copyright forms
- **eBay VeRO** — Verified Rights Owner program
- **Alibaba IPP** — IP Protection Platform
- **TikTok Shop IP Protection**
- **Shopify DMCA / trademark reporting**

A marketplace takedown often resolves in days; a C&D gives the infringer time to negotiate while selling. The two paths are not mutually exclusive — recommend filing both when conduct is marketplace-based, with the C&D covering any off-platform conduct the platform report cannot reach. Note in the pre-send brief whether the parallel-path has been filed, is queued, or is declined (and why). If declined, say why.

### Step 5: Calibrate to Posture

If the attorney has stated an enforcement posture in this conversation or prior context, apply it. If no posture has been given, ask one short question: "What's the enforcement posture here — aggressive (short deadline, explicit consequences), measured (professional firmness, open to discussion), or conservative (soft framing, longer deadline, muted consequences)?" — and explicitly flag the assumption you are using.

- **Aggressive** — firm letter, short deadline (7–14 days), explicit consequences (litigation, statutory damages under 15 U.S.C. §1117 / 17 U.S.C. §504, attorneys' fees, injunctive relief), no settlement softening
- **Measured** — firm but professional, standard deadline (14–30 days), consequences noted without theatrics, openness to discussion if they respond
- **Conservative** — soft letter framing, longer deadline or no hard deadline, "we'd like to discuss" opening, consequence language muted or absent

If the facts suggest a soft letter or direct filing would better serve the client, flag it before drafting:

> Per the posture discussed, this pattern may call for [a soft letter / going straight to filing]. Do you still want a C&D, or would you prefer the alternative?

### Step 5.5: Counterparty Diligence — Required Before Drafting

Before drafting, collect and present counterparty diligence in one block for the attorney's review. Do not proceed to drafting until the attorney has engaged with it. Use web_search and any documents or sources the attorney provides; flag sources and confidence level on each item.

```
## Counterparty Diligence — [Entity Name]

- **Entity:** [exact corporate name, state of formation, parent if any, d/b/a aliases]
  Source: [web_search / Secretary of State / attorney-provided / unconfirmed — SME VERIFY]
- **Size:** [headcount band, revenue band, funding stage if startup]
  Source: [LinkedIn / press / Crunchbase / unconfirmed — SME VERIFY]
- **IP portfolio:** [registered marks or copyrights in adjacent classes — or "none found in quick search"]
  Source: [USPTO TESS / TSDR / web_search — SME VERIFY]
- **Litigation history:** [prior IP cases as plaintiff or defendant — or "none found in quick pass"]
  Source: [web_search / public dockets — SME VERIFY]
- **Counsel:** [known outside IP counsel from prior filings — or "none identified"]
  Source: [web_search — SME VERIFY]
- **DJ-plaintiff risk:** [high / medium / low — one sentence of reasoning]
- **Relationship risk:** [any customer / investor / partner / acquirer overlap — or "none identified"]

**Confirm before I draft:**
- Do you want to proceed with a C&D against this counterparty given the diligence above?
- Does anything in the diligence change the posture or demand?
```

If critical items cannot be confirmed (entity unverifiable, size unknown, not on any public register), say so and flag:

> I can't confirm [entity / size / counsel] from available sources. Do you have this, or should we pause until a paralegal runs the confirmation?

If the diligence reveals a current customer, joint venture partner, potential acquirer, or similar relationship with the client, flag before drafting — this may warrant escalation.

### Step 6: Draft the Letter

Draft structure:

1. **Sender / letterhead and date**
2. **Recipient block**
3. **Re: line** — concise; does not reveal privileged strategy. Example: `Re: Unauthorized Use of [MARK] (US Reg. No. [•])`
4. **Opening** — identify the sender, the right, and the purpose of the letter
5. **The right** — trademark: reg number, class, first-use date, registration status; copyright: registration number, title, year; common-law: first-use date, geographic scope, evidence of acquired distinctiveness
6. **The infringing conduct** — specific: who, what, where, when, evidence cited
7. **The legal basis** — cite as applicable: `[CITE: Lanham Act §32 / §43(a) — 15 U.S.C. §1114 / §1125(a) — model knowledge, verify]`, `[CITE: 17 U.S.C. §501 — model knowledge, verify]`, state UCL or unfair trade practices statutes (North Carolina Unfair and Deceptive Trade Practices Act, N.C. Gen. Stat. §75-1.1, may apply — `[SME VERIFY]`)
8. **The demand** — numbered, specific, proportionate
9. **The deadline** — calendar date, method of confirmation
10. **Consequences of non-compliance** — calibrated to posture
11. **Preservation demand** — documents, communications, metadata related to the accused conduct
12. **Reservation of rights** — "without waiver of any claims or remedies, whether at law or in equity"
13. **Signature block** — attorney of record

**Drafting rules:**

- **Specificity over adjectives.** Dates, URLs, reg numbers, samples. Adjectives are a tell that the facts are thin.
- **No overbroad assertions.** If the mark is registered in one class and the accused use is in a different class, say so. Overbroad C&Ds are evidence of bad faith.
- **Citations as placeholders unless verified.** Every citation carries a source tag — `[user provided]`, `[model knowledge — verify]`, `[web search — verify]`. Never strip the tags before the attorney has verified.
- **Consequence language matches posture** per Step 5.
- **Jurisdiction-specific hooks** — for US/NC: Anti-Cybersquatting Consumer Protection Act (15 U.S.C. §1125(d)) for domain matters; §43(a) for unregistered marks; §504(c) timing for copyright statutory damages. If conduct or counterparty is outside the US, flag — the draft may need foreign associate review.

### Step 7: The Loud Gate Before Presenting the Draft

Display this gate before presenting the draft. The attorney must engage with it — a blank acknowledgment is not enough.

```
┌─────────────────────────────────────────────────────────────┐
│  BEFORE THIS DRAFT GOES ANYWHERE                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  This is a draft for attorney review — not a letter to      │
│  send. Sending a cease-and-desist letter is an assertion    │
│  of legal rights with real consequences:                    │
│                                                             │
│  • It can trigger a declaratory judgment action in a        │
│    jurisdiction of the recipient's choosing. A well-funded  │
│    recipient can use a C&D as an invitation to pick a       │
│    hostile forum.                                           │
│                                                             │
│  • Overbroad or bad-faith assertions can be used against    │
│    the sender — §43(a)(1)(B) claims, Rule 11 sanctions,     │
│    attorneys' fees under the Lanham Act / Copyright Act.    │
│                                                             │
│  • It starts a dispute that may not settle cheaply.         │
│                                                             │
│  Confirm before the letter leaves:                          │
│                                                             │
│    1. The rights asserted are valid — registered (pulled    │
│       from the register, not assumed) or solidly common     │
│       law with documented first use.                        │
│    2. The claim is colorable — a reasonable practitioner    │
│       would make it on these facts.                         │
│    3. The demand is proportionate to the conduct.           │
│    4. The attorney with authority to start this dispute      │
│       has approved.                                         │
│    5. Counterparty diligence (Step 5.5) was presented       │
│       and reviewed — entity, size, IP portfolio, prior      │
│       litigation, counsel, declaratory judgment risk, and   │
│       relationship risk.                                    │
│                                                             │
│  Parallel-path status (marketplace conduct): [filed /       │
│  queued / declined — from Step 4. "Not applicable" if       │
│  conduct is not on a marketplace.]                          │
│                                                             │
│  All [CITE] and [VERIFY] tags in the draft must be          │
│  resolved before the letter is sent. Fabricated or          │
│  misquoted cites in a sent C&D are professional             │
│  responsibility exposure.                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Step 8: Present the Draft

Present the letter as text in chat for the attorney to review and iterate on. Do not mark it as final or ready to send until the attorney confirms.

**Reviewer-facing closing note** (show in chat, not in a version sent to counterparty):

> This is a draft cease-and-desist letter for attorney review. It is not ready to send. Sending it is an assertion of legal rights with the consequences described in the gate above. A licensed attorney reviews, edits, and takes professional responsibility before it goes out. Do not send this draft unreviewed.

**After the attorney approves,** present a post-send checklist in chat for them to work through before delivery:

- [ ] Final read by approving attorney completed
- [ ] All `[VERIFY]` and `[CITE]` tags resolved and confirmed
- [ ] Work-product / privilege header stripped from the outgoing letter
- [ ] Attorney signature confirmed
- [ ] Delivery method selected; proof of delivery to be retained
- [ ] Compliance deadline calendared
- [ ] Response plan in place if deadline passes without compliance
- [ ] Matter created or updated in the app

---

## Receive Mode — Triaging the Incoming Cease and Desist

### Step 1: Read the Letter

Ask the attorney to paste the letter text or describe it. Extract:

- **Sender** — entity, signer, outside counsel if any
- **Recipient** — which of the client's entities or people
- **Delivery method and date received**
- **Asserted right** — trademark (reg number? jurisdiction?), copyright (registered? title?), both, other
- **Alleged conduct** — their version of what the client is doing
- **Legal basis** — statutes, contract provisions, theories cited
- **Demand** — what they want; deadline stated?
- **Threats** — what they say they will do
- **Tone** — firm / soft / scorched-earth; outside counsel signature usually signals seriousness

### Step 2: Assess the Assertion

This is a structured read, not a legal merit opinion. Flag uncertainty clearly.

- **Rights validity.** Are the asserted registrations real and active? Use web_search to check USPTO TSDR and Copyright Office records. Flag any that look dormant or questionable — `[SME VERIFY]`.
- **Plausibility of confusion / infringement.** On the facts as alleged, is this a colorable claim or a stretch? For trademark: likelihood of confusion turns on multi-factor tests (North Carolina follows the Fourth Circuit; the factors are similar to Polaroid/Sleekcraft — `[SME VERIFY]`). For copyright: access plus substantial similarity. Flag where the claim looks weakest.
- **Overbreadth.** Are they demanding more than the conduct warrants? Overbroad demands can weaken leverage and support an unfair-assertion counter.
- **Timing.** Laches, statute of limitations, copyright registration timing for statutory damages — flag any date issues on the face of the letter.
- **Forum.** Where would they sue? Is there a declaratory judgment opportunity if we want to pick a favorable forum first?

### Step 3: Assess the Client's Exposure

- **Is the client actually infringing?** Honest read on the facts presented.
- **Could they stop easily?** Cost of compliance versus cost of fighting.
- **Is the sender credible?** Known-litigious? Repeat-plaintiff? A troll operating a C&D campaign? Note any public information found via web_search.
- **What is at stake beyond this dispute?** Brand equity, customer relationships, precedent for similar claims.

### Step 4: Options

Present all applicable options with tradeoffs:

**A — Comply quickly**
- When: the claim is colorable, compliance is cheap, and the fight is not worth it
- Tradeoff: establishes a concession the other side may point to later; may embolden future assertions
- Next step: confirm compliance in writing (narrowly), do not concede the broader theory

**B — Negotiate**
- When: there is a business deal (license, coexistence, rebranding timeline) that resolves it
- Tradeoff: commits time; settlement communications need careful posture (Federal Rule of Evidence 408 / North Carolina Rule 408 — protection attaches from substance and context, not just labeling)
- Next step: sending a holding letter to pause the clock, then opening a negotiation track

**C — Respond firmly (reject)**
- When: their claim is weak, overbroad, or factually wrong; the goal is to close this down without litigating
- Tradeoff: locks in a position; if the claim is in fact colorable, our response becomes an exhibit
- Next step: draft a response letter in send mode

**D — Ignore (and preserve)**
- When: the claim is frivolous, the sender has no apparent capacity to sue, no legal consequence attaches to the stated deadline
- Tradeoff: silence can be read as non-denial in some contexts; a legal hold is required regardless; filing may follow silence
- Next step: issue a legal hold; log the demand; calendar a check-in date

**E — Pre-empt with a declaratory judgment action**
- When: the client faces real business uncertainty, the claim is weak, and the client benefits from picking a favorable forum first
- Tradeoff: going on offense; budget and attorney authorization required; now there is a lawsuit
- Next step: outside counsel engagement — do not draft a complaint here

**F — File to cancel their mark (TTAB) or challenge their copyright registration**
- When: their underlying right is vulnerable and the client wants to take the instrument off the board
- Tradeoff: slow, expensive, public; separate from the immediate dispute
- Next step: outside counsel engagement — do not draft a TTAB petition here

Recommend one option with two sentences of rationale. Be specific about why. Explicitly mark the recommendation: `[SME VERIFY: attorney to confirm before executing]`.

### Step 5: Deadline Triage

- **Their stated deadline** — note it, but a stated deadline does not legally bind the recipient unless a specific statute gives it teeth.
- **Internal decision deadline** — typically the stated deadline minus enough time to draft, review, and approve a response. Flag it for calendaring.
- **Legal deadlines** — statute of limitations on any underlying claim, contractual cure periods, procedural timelines.

Ignoring a stated deadline is a choice, not a default. Filing often follows silence, not the deadline date.

### Step 6: Triage Memo

Present the following memo in chat:

```
PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT
Prepared by: [attorney name] in anticipation of litigation / for legal advice
Do not forward, attach to an insurance tender without scrubbing, or share with counterparty.

# Cease and Desist Received — Triage Memo

> READ FOR TRIAGE, NOT OPINION. This is an intake scan and options analysis — not a
> legal merit opinion. Every cited statute or case is flagged for SME verification;
> every merit call is the attorney's, not the assistant's.

**Received:** [YYYY-MM-DD]
**Received by:** [entity / person]

## The Assertion

**Sender:** [entity, signer, counsel]
**Asserted right:** [trademark / copyright / both — with specifics, reg numbers, jurisdictions]
**Alleged conduct:** [their version, one paragraph]
**Demand:** [list — specific asks]
**Their stated deadline:** [date]
**Tone:** [firm / soft / scorched-earth]

## Rights Validity

[Registrations as asserted — `[SME VERIFY]` against the register; common-law claims
evaluated against the evidence cited]

## Legal Basis Cited

[Each citation inline-tagged with source: `[user provided]`, `[model knowledge — verify]`,
`[web search — verify]`. Do not rely on any citation here without independent check.]

## Plausibility Assessment

- **Confusion / similarity / infringement on the facts:** [read]
- **Overbreadth:** [read]
- **Timing issues (laches, statute of limitations, registration timing):** [read]
- **Forum / declaratory judgment opportunity:** [read]

## Client's Exposure

- **Actually infringing?** [honest look on the facts presented]
- **Cost of compliance vs. cost of fight:** [read]
- **Sender credibility:** [troll / real claimant / repeat plaintiff — with any public information]
- **Collateral stakes:** [brand, customers, precedent]

**Triage rating:** [substantial / debatable / weak / frivolous]
*Structured read for routing only — not a merit opinion; `[SME VERIFY]`*

## Options

### A. Comply quickly
[Rationale, tradeoffs, next step]

### B. Negotiate
[Rationale, tradeoffs, next step]

### C. Respond firmly
[Rationale, tradeoffs, next step]

### D. Ignore and preserve
[Rationale, tradeoffs, next step]

### E. Pre-empt with declaratory judgment
[Rationale, tradeoffs, next step]

### F. File to cancel / challenge the right
[Rationale, tradeoffs, next step]

**Recommendation:** [A / B / C / D / E / F] — [two sentences why]
`[SME VERIFY: attorney to confirm before executing]`

## Deadlines

- **Their stated deadline:** [date]
- **Recommended internal decision deadline:** [date]
- **Legal deadlines on any underlying claim:** [statute of limitations, cure periods, procedural — with dates]

## Immediate Actions

- [ ] Legal hold issued — [yes / no / in progress]
- [ ] Matter created or updated in the app — [yes / no / TBD]
- [ ] Attorney assigned — [who]
- [ ] Insurance coverage checked — [yes / no / N/A]
- [ ] Internal escalation completed — [who / when]
```

Close with this guardrail verbatim:

> This is a triage memo, not advice. The strength assessment above is a first read based on the letter alone — it does not account for facts you have not told me, registrations I cannot verify from public sources, or jurisdictional nuances. An attorney evaluates before you respond, decide to ignore, or commit to any path.

### Step 7: Hand Off

Based on the attorney's chosen option:

- **Respond firmly** → offer to draft a response letter in send mode, pre-populated with the response context. The send-mode gate runs again.
- **Negotiate** → draft a holding letter and opening negotiation track in chat for the attorney to review.
- **Pre-empt or file to cancel** → refer to outside IP litigation counsel; do not draft a complaint or TTAB petition here.
- **Comply or ignore** → log the decision in the matter; issue or confirm the legal hold; close the triage record.

---

## Decision Posture on Uncertain Calls

When uncertain whether there is infringement, whether a mark is confusingly similar, whether a work is substantially similar, or whether sending is safe — do not silently decide it is fine. Flag it for attorney review, surface the factors cutting both ways, and note the uncertainty. Sending a C&D on an assumption is a one-way door; surfacing doubt is a two-way door.

Apply the firm's stated positions if provided in context. If a position is not given on a specific question, ask one short question or use a conservative default and explicitly flag the assumption.

---

## What This Skill Does Not Do

- **Send the letter.** Draft only. The attorney sends after approval.
- **Invent or verify legal citations.** Every citation is a placeholder tagged with its source until the attorney or a legal research tool verifies it. Inventing or misquoting cites in a sent C&D is professional responsibility exposure.
- **Skip the gate.** The send-mode gate runs every time.
- **Render a definitive merit opinion on the receive side.** The triage rating is a structured read for routing; formal merit opinions are the attorney's.
- **Access Westlaw, LexisNexis, CourtListener, or other legal research databases directly.** Use web_search and the documents and sources the attorney provides. Flag the limitation on any cite that would benefit from a citator run.
- **File, docket, or take external action.** All execution is the attorney's.
