---
slug: product.marketing-claims-review
name: Marketing Claims Review
practice_area: product
description: Review marketing copy claim-by-claim for substantiation gaps, comparative-claim exposure, implied-claim risk, and absolute-claim liability, then suggest compliant rewrites.
when_to_use: When the attorney pastes marketing copy (landing pages, emails, ads, taglines, social posts) and asks whether it can be published, what needs fixing, or whether a specific claim is puffery or a legal problem.
user_invocable: true
---

## Purpose

Marketing wants to say the product is the best. Legal needs it to be true, or at least not provably false. This skill finds the claims that will draw a demand letter from a competitor or an inquiry from a regulator, and suggests how to keep the energy while fixing the exposure.

> **Every output is a draft for attorney review — not legal advice and not a legal opinion.** The attorney owns the legal conclusion. Nothing here clears copy for publication without attorney sign-off.

---

## Jurisdiction assumption

Default to **US federal** advertising law (FTC Act § 5 [settled], Lanham Act § 43(a) [settled]) plus **North Carolina UDAP** (N.C. Gen. Stat. § 75-1.1 [verify]) unless the attorney specifies a different jurisdiction or the copy targets a different state or country. Surface this assumption explicitly at the top of every review.

If the copy implicates a regulated sector (healthcare, financial products, children's products, dietary supplements, alcohol), note that additional sector-specific regimes apply and flag them for attorney research before clearing.

---

## Firm positions and substantiation standards

Apply the firm's stated positions on comparative claims and substantiation standards if the attorney provides them in context (e.g., "we never name competitors" or "we require a 95%-confidence study before any performance stat"). If no position is given, use conservative defaults and flag the assumption explicitly:

- **Comparative claims:** assume *allowed only with substantiation on hand* unless told otherwise.
- **Substantiation standard:** assume the FTC's "competent and reliable scientific evidence" or "reasonable basis" standard (depending on claim type) [verify].
- **Prior rejected claims:** if the attorney mentions past claims that were pulled, treat those as blacklisted for this review.

Ask one short question if a critical position is missing rather than guessing.

---

## Research the applicable standards before clearing copy

Use `web_search` to verify the currently operative advertising and substantiation standards for the applicable jurisdiction and media — FTC rules, NAD guidance, relevant state UDAP provisions, sector-specific rules, and platform policies. Identify what substantiation the *specific claim* requires: who measured it, when, sample size, apples-to-apples basis.

Flag implied claims and comparative claims for heightened scrutiny. Verify currency: endorsement and review guides are updated frequently.

> **Only cite the standards that apply to specific claims under review.** A blanket list of every FTC guideline makes the load-bearing ones invisible. A standard earns its place in the output by mapping to a quoted claim; otherwise drop it.

> **No silent supplement.** If web_search returns thin results for a standard, report what was found and stop. Say: "Search results are thin for [standard / jurisdiction]. Options: (1) broaden the query and retry, (2) search for the primary source directly, (3) continue with the result tagged `[web search — verify]` and flag for attorney verification before relying. Which would you like?" The attorney decides whether to accept lower-confidence sources.

### Source attribution tiering

Tag every citation with its source tier:

- `[settled]` — stable statutory/regulatory concepts unlikely to have changed (e.g., FTC Act § 5 as a concept). Lower verification priority but still verify before approving copy.
- `[verify]` — real citations that should be checked: specific FTC enforcement actions, NAD decisions, state UDAP statutes, sector rules, platform policies, case holdings, effective dates. These update frequently.
- `[verify-pinpoint]` — pinpoint citations (specific subsection letters, CFR subpart references, case paragraph numbers) carry the highest fabrication risk. **Always** verify against a primary source.
- `[web search — verify]` — results from web_search. Check against the issuing authority before relying.

Never strip or collapse these tags. A reader who verifies everything verifies nothing — the tags surface where real work is needed.

---

## Claim taxonomy

### Vague / subjective claims (puffery)

Subjective assertions with no measurable content. Whether they are actionable depends on jurisdiction, context, and audience — research before concluding.

| Example |
|---|
| "The best way to manage your projects" |
| "You'll love it" |
| "Revolutionary" |

### Specific factual claims

Measurable, specific — a reasonable person might rely on them.

| Example | Substantiation to look for |
|---|---|
| "50% faster than [competitor]" | Benchmark data, disclosed methodology, date |
| "Trusted by 10,000 companies" | Actual count (*currently* trusted, not cumulative signups) |
| "Saves 5 hours per week" | Study or customer data, disclosed sample |
| "Enterprise-grade security" | Define it — SOC 2? ISO 27001? Spell it out or it's a vague promise |
| "HIPAA compliant" | BAA available, actually configured for it — this is a contractual promise |

### Comparative claims (heightened scrutiny)

Naming a competitor or implying one. Research the applicable rules for comparative advertising in the relevant jurisdictions and media before clearing.

| Example | Fix pattern |
|---|---|
| "Faster than Slack" | Either name Slack with head-to-head data you can defend, or abstract to "faster than legacy chat tools" with substantiation |
| "The only platform that does X" | False if anyone else does X — "The first platform to…" (if true) or drop "only" |
| "[Competitor] can't do this" | Show your feature. Let the viewer compare. |

Apply the firm's comparative-claims policy if provided. If not provided, flag all comparative claims for attorney decision before shipping.

### Implied claims

Not stated outright but a reasonable reader infers it. Research the treatment of implied claims under the applicable advertising regime — implied claims often carry the same substantiation burden as express ones.

| Example | Implication | Fix |
|---|---|---|
| "Finally, a secure alternative" | Competitors are insecure | "Finally, security you can verify" |
| Customer logos without context | These companies endorse us | "Customers include…" is fine; "Trusted by…" implies more |
| "Built for healthcare" | HIPAA compliant | Clarify or qualify |

### Absolute claims

No room for error. One counter-example makes them false. Research whether qualifications cure the issue in the applicable jurisdiction.

| Example | Fix pattern |
|---|---|
| "Never goes down" | "99.9% uptime" (with SLA that defines it) |
| "100% accurate" | A specific, substantiated percentage tied to a benchmark |
| "Guaranteed" | Only if you actually offer a guarantee with terms — this creates warranty exposure |
| "Always" / "Every" | "Typically" / "Most" |

---

## The review

### Step 1: Extract every claim

Read the copy. List every sentence or phrase that asserts a fact, makes a comparison, or promises something. Note pure puffery but keep it in the output — the attorney may want to see what was excluded and why.

### Step 2: Classify and check each claim

For each claim:

```markdown
**Claim:** "[exact quote]"
**Type:** [Specific factual | Comparative | Implied | Absolute | Puffery]
**Substantiation on file:** [Attorney provided | Not provided | Unknown — ask attorney]
**Call:** [✅ Fine | ⚠️ Needs substantiation | ⚠️ Needs rewording | 🔴 Cut]
**Suggested fix:** "[alternative phrasing that keeps the energy]"
**Why:** [one line]
```

### Step 3: Check for product drift

Does the product actually do what the copy says? Marketing copy is often written from an early spec; the product changed and nobody updated the copy. If the attorney has shared a product description, spec, or PRD in context, check claims against it. If not, flag any claims that seem aspirational rather than current and ask the attorney to confirm with the product team.

### Step 4: Present the result

```markdown
# Marketing Review: [Campaign/Asset name]

**Reviewed:** [date]
**Asset:** [landing page / email / ad / tagline / etc.]
**Jurisdiction assumed:** US federal + North Carolina UDAP, unless noted otherwise.

---

## Summary

[N] claims reviewed. [N] ✅  [N] ⚠️  [N] 🔴

**Ready to ship:** [Yes — attorney review confirmed | Changes needed (see below) | No — rewrite needed]

> **Attorney gate:** Approving a marketing claim for publication is a legal act. Once published, substantiation gaps and comparative-claim exposure become enforcement or competitor-challenge risk. This review is a draft analysis — the attorney must sign off before copy goes live. If you need a brief to bring to a supervising attorney, say so and one will be generated.

---

## Claim-by-claim

[All claim blocks from Step 2, grouped: 🔴 first, then ⚠️, then ✅]

---

## Suggested revision

[For short assets — under 50 words, a tagline, headline, or one-liner — paste the revised copy here with fixes applied inline. The attorney should be able to copy-paste this block directly.]

[For assets 50–300 words, show the revised copy with fixes applied inline.]

[For assets over 300 words, summarize the changes as a bulleted diff ("Strip Claim 1. Rewrite Claim 3 to drop 'any.' Soften Claim 4 for regulated-domain risk.") rather than pasting the whole asset.]

---

## Substantiation needed before ship

| Claim | Need | From whom |
|---|---|---|
| [claim] | [data type] | [PM / data team / eng / attorney to confirm] |

---

## Citation check

Any FTC rules, NAD decisions, state UDAP statutes, sector regulations, or platform policies cited in this review were retrieved via web_search or generated from model knowledge. Verify every `[verify]` and `[verify-pinpoint]` citation against a primary source (FTC.gov, NAD.org, the relevant state statutes, or the platform's current policy page) before relying on it to clear or reject copy. Endorsement guides, platform rules, and state UDAP regimes update frequently. `[settled]` citations are lower-priority but should still be confirmed before approval.
```

---

## Disclosure overlays

Copy involving any of the fact patterns below sits inside an additional disclosure regime. Use web_search to verify the currently operative requirements in the applicable jurisdictions (including platform policies and sector-specific rules) — these regimes update frequently.

- **Testimonials / reviews** — material connections between the speaker and the advertiser are typically disclosable; research the current form and placement rules
- **Influencer content** — research the current tagging, clarity, and conspicuousness requirements for the channel and audience
- **"Results may vary" / atypical results** — research whether a disclosure (and what form) is required when shown results aren't representative
- **Free trial / auto-renewal / negative option** — research the current conspicuousness and consent requirements for auto-conversion terms

---

## Next steps for the attorney

At the end of every review, present a short decision tree:

1. **Copy is clean (no 🔴, no unresolved ⚠️):** Confirm with attorney and client, then ship.
2. **Changes needed (⚠️ items):** Apply suggested revisions, confirm substantiation is on file, then return for a final pass.
3. **Substantiation missing:** Route the substantiation table to the product/data team. Do not ship until data is confirmed.
4. **Comparative claims flagged:** Attorney decides: (a) secure substantiation and name the competitor, (b) abstract the comparison, or (c) cut.
5. **Regulated sector implicated:** Attorney reviews sector-specific rules before any claim in that category ships. Do not clear unilaterally.

---

## What this skill does not do

- It does not write the marketing. It fixes what is wrong with it. Suggested rewrites keep the energy, but the marketer owns the voice.
- It does not substantiate claims. It identifies which ones need substantiation and who has the data.
- It does not review design or imagery — words only. If an image implies a claim (a competitor logo with a red X through it), flag it, but visual review is a human judgment.
- It does not replace attorney review. Every output is a draft analysis. The attorney owns the legal conclusion.
