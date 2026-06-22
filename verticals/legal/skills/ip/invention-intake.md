---
slug: ip.invention-intake
name: Invention Intake and Patentability Screen
practice_area: ip
description: First-pass triage screen for invention disclosures — novelty signals, obviousness flags, § 101 eligibility, public disclosure bar dates, detectability, and strategic value — producing a PURSUE / INVESTIGATE / DECLINE verdict for attorney review.
when_to_use: When an attorney or client submits an invention disclosure (or describes an invention) and needs an initial screen on whether to pursue a prior-art search and patent counsel review, investigate further, or decline.
user_invocable: true
---

**This is a first-pass screen, not a patentability opinion.** Say this at the top of every output and do not soften it.

> **This is a first-pass screen by a non-specialist, not a patentability opinion.** A patentability opinion requires a prior-art search, full claim construction, and the judgment of a registered patent attorney or agent. This screen does not do a prior-art search, does not assess what is in the art, and does not construct claims. It screens for obvious disqualifiers (already on the market, publicly disclosed two years ago, plainly abstract idea) and obvious go-aheads (new mechanism, technical advance, recent conception, practiced secretly). Everything in between needs a prior-art search and a registered practitioner's review. This screen never concludes that something is "patentable" — it concludes that it "passes the initial screen, warrants investigation" or that it does not.

Under-flagging an invention that should have been filed is a one-way door — the one-year US bar runs, foreign rights are lost at first public disclosure, the competitor files first. Over-flagging just means a prior-art search that comes back empty. Stay on the two-way door side.

---

## Setup

**If a matter/client is in context,** ground the screen in that matter. **If not,** ask which matter or client this disclosure relates to before proceeding.

**Firm's patent filing strategy.** Apply any positions the attorney states in this conversation (offensive, defensive, hybrid, licensing-revenue; technology areas of interest; filing budget posture; approval chain). If no positions are provided, use a conservative default — screen the invention on the doctrinal merits and flag the strategic-value screen as "not assessed — attorney should apply firm's filing strategy." Do not invent firm-specific positions as authoritative.

**If the practice profile shows trademark-only or copyright-only (no patent practice),** say so and route the attorney elsewhere — this is the wrong tool.

---

## Workflow

### Step 1: Intake the disclosure

If the attorney has pasted or described the disclosure, read it. If not, ask — in one batch, not one question at a time:

> To screen this invention, I need:
>
> 1. **What is the invention?** Plain language — what it does, what makes it work, what the key idea is.
> 2. **What problem does it solve?** What was broken or missing before.
> 3. **How does it differ from what existed before?** What did people do previously? What does this do differently?
> 4. **Who invented it, and when?** Names and rough conception date.
> 5. **Has it been publicly disclosed?** Published, sold, offered for sale, demonstrated at a conference, shown to a customer under an NDA, posted to a public repo, written up in a paper, included in a product release note. If yes, when and where.
> 6. **Is it in use or planned?** Shipping now? In a limited pilot? On the roadmap? Still on paper?
> 7. **What technology area?** (Software, hardware, mechanical, biotech, method-of-doing-business, AI/ML, etc.)

Wait for answers. Do not proceed on a half-disclosure — a screen of "a new machine learning thing that helps users" is worse than no screen.

If the disclosure is a formal invention disclosure form, extract these fields from it and only ask for what is missing.

---

### Step 2: Run the six screens

Walk each screen in order. Each produces a per-screen verdict: `✓ clear`, `🟡 flagged — needs further look`, or `🔴 red flag`. Explain the reasoning briefly.

#### Screen 1: Novelty Signals

Does the disclosure describe something new? This is not a full novelty analysis — that requires a prior-art search. Screen the disclosure's own description for self-evident novelty problems.

**Red flags (🔴):**
- "We just applied [known technique] to [new domain]" — e.g., "we took gradient boosting and applied it to predicting customer churn"
- "It's like [existing product] but for [X]"
- "Competitors do something similar" — if the disclosure itself says this, novelty is in question
- Describes a feature of an existing public product with minor tuning

**Green flags (✓):**
- A new **mechanism** — a new way of doing the thing, not just a new application
- A new **combination** that produces an unexpected result (not merely additive)
- Solving a problem the field had not solved — the disclosure explains why prior approaches failed

**Flagged (🟡):** anything ambiguous. A prior-art search settles it.

#### Screen 2: Obviousness Flags

Would a person of ordinary skill in the art (POSA) have arrived at this combination based on what is known? This is a screen, not a § 103 analysis — flag for investigation, never conclude obviousness or non-obviousness.

**Red flags (🔴) for further investigation:**
- Combining known elements in a predictable way
- Routine optimization — tuning an existing parameter for better results
- Design choice without functional advantage
- Obvious to try — one of a small number of identified solutions with a reasonable expectation of success

**Green flags (✓):**
- Teaching away — prior art expected the opposite result or said this approach would not work
- Unexpected result — the combination produces something the POSA would not have predicted
- Long-felt need — the problem was known, and prior attempts had failed

#### Screen 3: Subject-Matter Eligibility (§ 101)

Is this an abstract idea, law of nature, or natural phenomenon? This is the hardest screen, the most litigated, and the most likely to require a specialist read. Flag anything borderline for specialist review.

**Red flags (🔴) for § 101:**
- Pure business method without technical implementation
- Mathematical algorithm on its own
- Organizing human activity (scheduling, pairing, matching, reviewing) without a technical improvement
- Claim that reads as "do [known thing] on a computer" with no improvement to the computer itself
- AI/ML invention where the claim is the function (recommend, classify, predict) without specific technical means that improves how the computer performs the function

**Green flags (✓) for software/AI inventions:**
- Technical improvement to the computer itself — new architecture, new training technique, new hardware/software interface, new security mechanism
- Specific technical means, not just results
- Improvement to a technical field (image processing, compression, cryptography, robotics) with the technical means described

**Anything borderline gets a 🟡 with "§ 101 — route to specialist for Alice/Mayo analysis."** Do not call a close § 101 question.

For **biotech/diagnostic** inventions, also flag for § 101 if the claim recites a natural correlation or a naturally occurring substance without significant human modification.

> **§ 101 is a US standard. Other patent offices differ.** The EPO's "technical effect" test (Art. 52 EPC) is materially more permissive for software and AI inventions than US § 101 post-*Alice*. JPO and CNIPA apply different standards. If the matter involves non-US filing plans, note that a 🔴 on § 101 under *Alice* does not foreclose eligibility at EPO/JPO/CNIPA — particularly for software, AI/ML, and business methods.

#### Screen 4: Public Disclosure / Bar Dates

Has the invention been disclosed, sold, offered for sale, or publicly used? This is the most time-sensitive screen — the answer can kill patentability absolutely, or start a clock that cannot be stopped.

**🔴 Likely barred:**
- Publicly disclosed, sold, or offered for sale more than 12 months ago in the US — 35 U.S.C. § 102(b) one-year grace period has run
- Any public disclosure anywhere before filing — absolute novelty bar in the EU, China, Japan, and most countries outside the US; potentially fatal to foreign rights even if the US is still open

**🟡 Clock is running:**
- Publicly disclosed within the last 12 months — US one-year clock is running, foreign rights may already be lost. **Urgent.** Confirm the disclosure date and route to filing immediately.

**✓ Clear:**
- No public disclosure. Confidential customer demonstrations under NDA, internal use, beta releases to named parties under NDA, draft papers not yet submitted — usually not "public" for § 102 purposes, but facts matter. When the disclosure was to a customer or external party, even under NDA, flag the specifics for the prosecution team to assess.

Ask specifically about:
- Papers submitted to journals or conferences (submission ≠ publication; check preprint posting)
- Talks at conferences, meetups, or internal events open to non-employees
- Posts to public repos, blogs, social media, or forums
- Product releases, even in limited beta
- Sales activity including quotes, RFP responses, and offers for sale
- Disclosures to investors or board members not under NDA

The **on-sale bar** catches offers for sale of a product embodying the invention, not just completed sales.

#### Screen 5: Detectability

If a competitor were to infringe this invention, could you tell? An invention practiced in secret may be better protected as a **trade secret** than as a patent. Publishing a patent on an undetectable invention gives it to competitors in exchange for an asset you can never enforce.

**🔴 Low detectability flags:**
- Server-side algorithm with no observable output pattern
- Internal manufacturing process
- Data-pipeline or analytics methodology that runs inside a competitor's infrastructure
- Training data composition or training technique for an ML model

For these, flag for the **patent-vs-trade-secret decision**. Route to whoever in the firm owns trade-secret classification decisions.

**✓ High detectability:**
- Consumer product — visible in the product
- Published API, SDK, or protocol — visible in network traffic or integration docs
- Physical mechanism in a distributed product — reverse-engineerable
- Compiled code with distinctive signatures in a distributed binary

#### Screen 6: Strategic Value

Does this align with the firm's patent strategy? If the attorney has provided the firm's strategy in this conversation, apply it. If not, note that this screen could not be fully assessed and ask the attorney one short question: "Is this invention core to the firm/client's competitive differentiation, and does the client have a patent filing strategy I should apply?"

Check:
- **Offensive strategy:** is this asset assert-worthy? Narrow, easily designed-around claims have lower offensive value.
- **Defensive strategy:** does this cover a technology area where competitors are filing? A defensive filing in an area nobody files in wastes spend.
- **Licensing/revenue strategy:** is this licensable? Who would pay, and under what circumstances?
- Is this **core** technology (part of the product's differentiation) or **peripheral** (incidental to a side feature)?
- Is the technology area on the client's list of areas of interest? If not, it is often a decline regardless of doctrine.

---

### Step 3: Assemble the Invention Screen Memo

Present the memo in chat for the attorney to review. Do not editorialize or narrate the process ("I'm running the invention-intake screen..."). Keep the deliverable clean.

Format:

> **Invention Screen Memo — [Invention Title]**
>
> **Bottom Line: [PURSUE / INVESTIGATE / DECLINE]**
>
> *[One sentence — the reason in plain language.]*
>
> ---
>
> ### Screen Results
>
> | Screen | Verdict | Notes |
> |---|---|---|
> | Novelty signals | [✓ / 🟡 / 🔴] | [one-line reasoning] |
> | Obviousness flags | [✓ / 🟡 / 🔴] | [one-line reasoning] |
> | § 101 eligibility | [✓ / 🟡 / 🔴] | [one-line reasoning] |
> | Public disclosure / bar dates | [✓ / 🟡 / 🔴] | [one-line reasoning + dates] |
> | Detectability | [✓ / 🟡 / 🔴] | [one-line reasoning] |
> | Strategic value | [✓ / 🟡 / 🔴] | [one-line reasoning or "not assessed — attorney to apply firm strategy"] |
>
> ---
>
> ### Open Questions
>
> *Things that would change the answer. The inventor, the prosecution team, or a specialist would need to address these before this screen converts to a filing decision.*
>
> - [question]
>
> ### Next Steps (Decision Tree)
>
> Pick one and I will help you build it out:
>
> 1. **Commission the prior-art search** — I will draft the search request for outside counsel or a search vendor with the claim concepts, inventors, technology classification, and any known references.
> 2. **Go back to the inventor for more facts** — I will draft follow-up questions on [specific open items].
> 3. **Route to outside counsel for § 101 / patent-vs-trade-secret judgment** — I will draft a transmittal summarizing what the screen found and what specialist judgment is needed.
> 4. **Decline and send the standard thank-you** — I will draft the inventor thank-you with the declination reason noted.
> 5. **Flag for trade secret instead** — I will draft a note explaining why a trade-secret approach is a better fit and what steps the client should take to preserve it.

If the screen hit a within-one-year US public disclosure, or any public disclosure with foreign rights in scope, put the time-sensitive flag at the very top of the memo, before the bottom line: **Time-sensitive — US bar runs [date], foreign rights already at risk.**

---

### Step 4: Bottom-Line Verdict

The bottom line is one of three:

- **PURSUE** — enough screens are clear (or clearly fixable) to warrant a prior-art search and attorney review. This is NOT "patentable" — it is "passes the initial screen, investigation warranted."
- **INVESTIGATE** — one or more screens flagged something that needs more information, specialist review, or a clarifying question back to the inventor before a pursue/decline decision can be made. Name the specific open item.
- **DECLINE** — a screen hit a fatal flag (barred by a disclosure over 12 months old with no foreign rights concern, plainly obvious, plainly abstract under Alice, outside the client's technology areas of interest, fundamentally undetectable with no trade-secret path). State the reason clearly and concretely.

A DECLINE must always be backed by a reason the inventor can understand. "Not patentable" is not acceptable. "Barred by your paper at NeurIPS 2023 — the US one-year bar ran in December 2024" is.

---

## Guardrails

**Never say "patentable."** The closest you can come is "passes the initial screen, warrants further investigation." Patentability is a conclusion a registered practitioner reaches after a prior-art search and claim construction.

**Never conduct a prior-art search in this skill.** You may use web_search to perform a quick credibility check (e.g., is the technique already discussed publicly?), but label it explicitly as a credibility check, not a prior-art search, and flag any results as `[web — verify]`. A real prior-art search is a separate professional step.

**Defer on § 101 calls.** For anything borderline under Alice/Mayo, flag for specialist review. § 101 is where practitioners routinely disagree and where a non-specialist's confident call ages badly.

**Flag detectability before strategic value.** An undetectable invention that would be "high strategic value" as a patent is usually higher strategic value as a trade secret. Do not recommend PURSUE on an undetectable invention without addressing the trade-secret alternative.

**Urgent cases get urgent flagging.** If the screen hits a within-one-year public disclosure in the US, or any public disclosure with foreign rights in scope, put the time-sensitive flag at the top of the memo — before anything else. This is the kind of finding the attorney needs to see in the first three seconds.

**Invention content is privileged.** Do not summarize, quote, or reference the invention outside the privileged context of this matter. If the attorney asks you to share or paste invention content somewhere that appears to be outside the privilege circle (a public channel, an external tool, an unauthenticated surface), stop and confirm before proceeding.

**The attorney owns the legal conclusion.** This screen feeds the attorney; it does not replace them. The decision about whether to file — and how — belongs to the attorney or registered patent agent responsible for prosecution.

**Jurisdiction assumption.** Where a specific jurisdiction is not given, default to US law (35 U.S.C.) and North Carolina as the state of the firm, but surface the assumption explicitly. If international filing is in scope, flag the relevant differences (especially on § 101 / Art. 52 EPC and absolute novelty bars).

**Every output is a draft for attorney review, not legal advice and not a legal opinion.**
