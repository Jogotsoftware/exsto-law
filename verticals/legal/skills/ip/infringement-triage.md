---
slug: ip.infringement-triage
name: Intellectual Property Infringement Triage
practice_area: ip
description: Triage whether someone is infringing the firm's IP (or the firm may be infringing theirs) across trademark, copyright, patent, and trade secret — producing a factor flag list, not a finding.
when_to_use: Attorney describes a potential infringement situation — knockoff product, competitor mark, copied content, suspicious ex-employee, patent assertion — and needs a structured factor analysis before deciding whether to assert, respond, or investigate further.
user_invocable: true
---

# Intellectual Property Infringement Triage

> **This is a triage, not a finding of infringement or non-infringement.**
> Infringement analysis is fact-intensive and legally complex. The triage identifies factors and flags what matters most — it does not conclude. A conclusion that something does or does not infringe is a legal opinion that requires an attorney's judgment on the facts, the scope of the right, the relevant jurisdiction's law, and the likely defenses. Acting on a triage — sending a cease-and-desist, refusing to stop, filing suit, or deciding not to — without attorney review is how companies end up on the wrong side of fee awards, Rule 11 sanctions, declaratory-judgment actions, and (for patents) treble damages.

Every output from this skill is a draft for the attorney's review, not legal advice and not a legal opinion. **The attorney owns the legal conclusion.**

---

## Starting the triage

Ask which right is at issue before walking any factors:

> Which right are we triaging?
>
> 1. **Trademark** — confusion, dilution, or false advertising
> 2. **Copyright** — substantial similarity, fair use, DMCA safe harbor
> 3. **Patent** — claim-chart first pass, literal read + doctrine of equivalents
> 4. **Trade secret** — secrecy, reasonable measures, misappropriation
> 5. **Mixed / not sure** — describe the facts and I'll help sort them

If the answer is "not sure," help the attorney sort the facts — the same facts can implicate multiple rights simultaneously (e.g., a former employee launches a competing product using your logo, a near-identical product design, and confidential technical notes — that is trademark + possible patent/copyright on packaging + trade secret, each with separate factors and remedies).

**If more than one right is in play, run the triage for each separately.** Do not blend them.

---

## Enforcement posture and firm positions

If the matter or firm settings in context specify an enforcement posture (aggressive / measured / conservative) or named approvers for assertion letters, apply those throughout. If no posture is provided, ask one short question:

> What's the firm's general posture here — do you want to lean toward asserting, want a conservative flag list to evaluate risk, or somewhere in between?

If the attorney does not answer, default to a **measured posture** and flag the assumption explicitly.

**Never invent firm-specific positions as authoritative.** If prior playbook positions (e.g., "we always assert in the Fourth Circuit for confusion at 70+ Polaroid score") are not in context, flag the gap and ask.

---

## Matter context

If a matter and/or client is active in context, ground the triage in those facts — reference the client name, the involved IP right, and any documents or facts already in context. If no matter is specified, ask:

> Which matter or client is this for? (Or is this a new potential matter?)

Present all triage output in chat for the attorney to review and save in the app if they choose.

---

## Jurisdiction

Default to **US federal law** and, where circuit-specific, the **Fourth Circuit** (North Carolina), unless the attorney specifies otherwise. Always surface the jurisdiction assumption explicitly in the output. Flag when foreign law may apply and note that the triage's frameworks do not transfer to other systems without jurisdiction-specific review.

---

## Common intake (all modes)

Before walking factors, gather:

1. **Posture.** Is the firm the potentially senior/asserting party (someone is taking ours), or the potentially accused party (we may be infringing)? The factors are symmetric but the output differs — a senior-party triage routes toward an assertion letter; an accused-party triage routes toward a risk memo.
2. **Jurisdiction.** Which country / circuit / state? US federal / Fourth Circuit default if not specified.
3. **Timing.** Is a statute of limitations or laches clock running? What is the first known date of the alleged infringement?
4. **Exhibits and evidence.** What does the attorney have — screenshots, URLs, packaging photos, code excerpts, contracts, access logs, registration numbers? Use web_search and any documents the attorney provides. Note that without access to Westlaw, CourtListener, or specialized patent databases, case law and prosecution history must be verified by the attorney through authoritative sources.

---

## Trademark mode

### Confusion analysis

Apply the circuit's multi-factor likelihood-of-confusion test. In the Fourth Circuit, use the *Pizzeria Uno Corp. v. Temple* / *George & Co.* factors. Walk each:

- **Similarity of marks** — sight, sound, meaning, and overall commercial impression.
- **Similarity of goods or services** — the expected-source test, not identity.
- **Channels of trade** — where each party sells and to whom.
- **Consumer sophistication** — how carefully the relevant consumers purchase.
- **Strength of the senior mark** — fanciful / arbitrary / suggestive / descriptive with secondary meaning / generic. Flag where on the spectrum.
- **Intent** — evidence of deliberate copying, knock-off trade dress, or a near-miss mark choice.
- **Actual confusion** — any evidence: misdirected inquiries, social media comments, survey evidence.
- **Likelihood of expansion / bridge the gap** — whether the commercial zones overlap or are likely to.

Flag what cuts toward the senior party and what cuts toward the accused for each factor.

### Dilution (if the senior mark is famous)

Apply the federal Trademark Dilution Revision Act (15 U.S.C. § 1125(c)) and any applicable state statute.

- **Fame threshold.** The mark must be famous to the **general consuming public** — niche fame is not enough. Flag whether national-consumer fame is plausible; if not, flag dilution as a stretch.
- **Blurring vs. tarnishment.** Blurring = harm to distinctiveness; tarnishment = harm to reputation.
- **Defenses.** Comparative advertising, news reporting, non-commercial use, fair use.

### False advertising / comparative claims

If the triage is prompted by a competitor's comparative ad or claim about product attributes, apply Lanham Act § 43(a) (15 U.S.C. § 1125(a)):

- Is the statement literally false, implicitly false / misleading, or mere puffery? (Puffery is not actionable.)
- Materiality — does the claim influence purchasing decisions?
- Substantiation evidence available or needed.
- Commercial speech element.

### Trademark output

Factors table with direction; a "not a finding" conclusion line; routing suggestion consistent with the firm's posture.

---

## Copyright mode

### Ownership

Is the claimant the copyright owner or an exclusive licensee with standing to sue? Flag work-for-hire questions, joint authorship, assignments, and termination rights.

### Registration

17 U.S.C. § 411 requires registration (or preregistration) as a precondition to filing a US federal infringement action. Under *Fourth Estate Public Benefit Corp. v. Wall-Street.com, LLC*, 586 U.S. 296 (2019), registration means the Copyright Office has actually issued the registration, not merely that an application was filed. Flag registration status; if not registered, flag the practical bar on filing suit and the option to register promptly for prospective relief.

### Access + substantial similarity

Two paths to proving copying:

- **Access + probative similarity** — the defendant had access to the work, and the works share features probative of copying.
- **Striking similarity** — even without proof of access, the similarity is so striking that independent creation is implausible.

For substantial similarity, apply the applicable circuit's test. In the Fourth Circuit, note the ordinary-observer approach and flag if facts suggest the Ninth Circuit's extrinsic/intrinsic test (*Krofft*/*Swirsky*) or other circuit variations may be relevant (e.g., if the accused party is based elsewhere).

### Fair use

17 U.S.C. § 107 four factors, analyzed as a whole — not individually in isolation:

1. Purpose and character of the use (transformativeness; commercial vs. non-commercial).
2. Nature of the copyrighted work (factual/functional vs. highly creative).
3. Amount and substantiality of the portion used — both quantitative and qualitative.
4. Effect on the market for the original and derivative markets.

Flag the transformativeness analysis carefully — *Andy Warhol Found. for the Visual Arts, Inc. v. Goldsmith*, 598 U.S. 508 (2023), narrowed the scope of transformative use under factor one and is still being applied by lower courts. Also note *Google LLC v. Oracle America, Inc.*, 593 U.S. 1 (2021). Fair use is fact-intensive; **the triage does not conclude on fair use**.

### DMCA safe harbor

17 U.S.C. § 512. If the accused is a service provider hosting user-generated content, flag whether § 512(c) applies: designated agent filed with Copyright Office, notice-and-takedown procedure in place, no actual or red-flag knowledge of infringement, no direct financial benefit attributable to infringement the provider has the right and ability to control, expeditious takedown on valid notice, repeat-infringer policy. Safe harbor does not protect the service provider's own direct infringement.

### Copyright output

Ownership and registration threshold notes; access/similarity flag; fair-use four-factor balance flagged (not concluded); DMCA safe harbor flag if applicable. Routing per posture.

---

## Patent mode

### Check the patent number prefix first

Before running any analysis, ask for the patent number and check its prefix:

- **`D` prefix — design patent (35 U.S.C. § 171).** Do NOT build a utility-patent claim chart. See the Design Patent branch below.
- **`RE` prefix — reissue patent.** Treat as the utility patent it reissued; flag reissue-specific defenses (intervening rights under § 252, recapture rule, original-patent requirement).
- **`PP` prefix — plant patent (35 U.S.C. § 161).** Route to plant-patent counsel; this skill does not analyze plant patents.
- **No prefix — utility patent.** Proceed to the utility patent workflow.

---

### Design patent branch

**Infringement test — ordinary observer.** *Egyptian Goddess, Inc. v. Swisa, Inc.*, 543 F.3d 665 (Fed. Cir. 2008) (en banc). The question is whether an ordinary observer, familiar with the prior art designs, would be deceived into thinking the accused design is the same as the patented design. Compare overall ornamental appearance, not individual elements. The accused product must appropriate the novelty that distinguishes the patented design from the prior art.

**Functional-vs-ornamental filter.** Design patents protect only ornamental features; similarities in features dictated purely by function fall outside the patent's scope. Flag which features look functional vs. ornamental.

**Broken lines.** Design patents use solid lines for claimed features and broken lines for unclaimed environmental context. Flag whether the alleged similarity is in solid-line (claimed) or broken-line (unclaimed) territory.

**§ 289 damages.** Design patent damages are the infringer's total profits on the "article of manufacture," which may be the whole product or a component. *Samsung Electronics Co. v. Apple Inc.*, 580 U.S. 53 (2016). This is specialist damages work — do not compute; flag it.

**Trade dress cross-flag.** The same ornamental-shape facts usually raise a parallel trade dress question under Lanham Act § 43(a). Product configuration trade dress requires secondary meaning (*Wal-Mart Stores, Inc. v. Samara Bros.*, 529 U.S. 205 (2000)) and must be non-functional (*TrafFix Devices*, 532 U.S. 23 (2001)). Flag trade dress as a parallel track.

Because you cannot directly view patent drawings or the accused product, the design patent triage is primarily a request for materials and a framing for the attorney's analysis:

> To run the ordinary-observer test I need: (a) the patent drawings (all figures, including broken-line disclaimers), (b) photos of the accused product from comparable angles, and (c) any prior art designs you're aware of. Please paste or attach those, and describe any features you believe are functional rather than ornamental.

Route to a design patent specialist for anything beyond this first-pass framing.

---

### Utility patent workflow

> **Note on jurisdiction.** The US claim-chart framework (all-elements rule, doctrine of equivalents, prosecution history estoppel, § 284/§ 289 damages) does not apply in other systems. A product manufactured abroad or sold in the EU needs EP/UPC analysis; sold in China needs CNIPA analysis; sold in Japan needs JPO analysis. Flag if non-US jurisdictions are in scope and note that jurisdiction-specific review is required.

Gather from the attorney:

- Description of the accused product, process, or method in technical detail.
- The patent number(s) and, if possible, the independent claims.
- Any prosecution history the attorney has or can retrieve.
- Any prior art already known.

**Claim chart — first pass.** Map each element of each independent claim to the accused product or process. Note: without direct access to patent databases (USPTO, Google Patents), ask the attorney to paste the claim text, or use web_search to find the published patent and pull the claims. Flag the search's limits.

- **Literal infringement** — does the accused product/process satisfy every element of the claim literally?
- **Doctrine of equivalents** — for any element not literally met, flag whether an equivalent (substantially same function, way, result) may apply. Flag prosecution history estoppel for any element narrowed during prosecution.
- **Indirect infringement** — induced (§ 271(b)) and contributory (§ 271(c)) infringement as flags.
- **Divided infringement** — if no single entity performs all steps of a method claim, flag the divided-infringement question.

**Invalidity defenses to flag:**

- § 102 anticipation — single prior art reference disclosing all elements.
- § 103 obviousness — combination of prior art references; *Graham v. John Deere* factors.
- § 112 written-description, enablement, and definiteness.
- § 101 subject-matter eligibility — *Alice/Mayo* framework for software and method claims.
- Known IPR or PGR outcomes from the PTAB.

**Unenforceability flags (attorney-only analysis):**

- Inequitable conduct during prosecution.
- Prosecution laches.
- Assignor or licensee estoppel.

**Damages posture flags:**

- Reasonable royalty (Georgia-Pacific factors) vs. lost profits.
- Patent marking compliance and pre-suit notice (affect damages period).
- Willfulness flag — reading this triage creates knowledge of the patent, which can factor into a willfulness analysis.

**Handoff note.** This is a first-pass claim chart to surface the strongest and weakest element mappings. For element-by-element claim charts suitable for infringement or invalidity contentions (with claim construction flags, dependent claims, pin cites), that is specialist litigation work requiring patent counsel.

---

## Trade secret mode

### Was it a secret?

Apply the Defend Trade Secrets Act (18 U.S.C. § 1836 et seq.) for federal purposes and the North Carolina Trade Secrets Protection Act (N.C. Gen. Stat. § 66-152 et seq.) as the default state law, unless another state's law is specified.

Flag:

- **Not generally known** — is the information known to the public or to others in the industry who could obtain economic value from it?
- **Economic value from secrecy** — does independent economic value flow from the information not being generally known?
- **Combinations and compilations** — a combination of otherwise public elements can qualify as a trade secret if the combination itself is secret and valuable.

### Reasonable measures

Flag what is in place and what is missing:

- NDAs with employees, contractors, and counterparties — scope, signed, enforced?
- Access controls — technical (role-based), physical (badges, locked areas), organizational (need-to-know).
- Confidentiality legends / marking on documents, code, and data.
- Exit interviews and return-of-materials procedures on termination.
- Trade-secret policy and employee training.

*Reasonable* is fact-specific; the triage lists the measures — the attorney determines whether they were legally reasonable.

### Misappropriation

Acquisition by improper means, or disclosure/use in breach of a duty. Improper means includes theft, bribery, misrepresentation, breach or inducement of breach of a duty to maintain secrecy, and espionage (18 U.S.C. § 1839(6)).

Key fact patterns to walk:

- **Former employee:** new employer, overlapping work scope, departure timing, documents taken (and returned?), access logs, recruiting channels, invention-assignment and confidentiality agreements.
- **Contractor or vendor:** scope of NDA, what was shared and why, whether use went beyond permitted scope.
- **Inadvertent disclosure:** was the disclosure by a person with a duty? Did the recipient know or have reason to know of the breach?
- **Reverse engineering defense:** lawful reverse engineering is a recognized defense — flag whether reverse engineering is plausible on the facts.

### Preemption

Where state tort claims (unfair competition, conversion, breach of confidence) might be preempted by the UTSA or DTSA, flag preemption. North Carolina's Trade Secrets Protection Act generally displaces conflicting state tort law on the same facts; contract claims are typically preserved.

### Trade secret output

Three flag groups — secrecy, reasonable measures, misappropriation — each with what cuts each way. Routing per posture.

---

## Output format (all modes)

```
# IP Infringement Triage — [Trademark | Copyright | Patent | Trade Secret] (NOT A FINDING)

> **This is a triage, not a finding of infringement or non-infringement.** The
> triage identifies factors and flags what matters most; it does not conclude.
> A conclusion requires an attorney's judgment on the facts, the scope of the
> right, the jurisdiction's law, and the likely defenses. Acting on this triage
> without attorney review risks fee awards, Rule 11 sanctions, declaratory-
> judgment exposure, and (for patents) treble damages.

**Triage result:** [GREEN / YELLOW / RED — one sentence explaining the dominant factor]

## Scope and posture

- **Party posture:** [senior/asserting | accused/at-risk]
- **Right at issue:** [trademark | copyright | patent | trade secret]
- **Jurisdiction assumed:** [US federal — Fourth Circuit (NC) | specify if different]
- **Legal framework applied:** [governing test and statute]
- **Statute of limitations / laches:** [clock status and first-known-date]
- **Exhibits / sources reviewed:** [list what was provided or searched]

## Factor analysis

[Mode-specific factor table — confusion factors / fair-use factors / claim chart
/ trade-secret elements. Each factor has a flag and a direction. This is
a flag list, not a verdict.]

## Defenses and thresholds to evaluate

[Mode-specific: dilution fame threshold / registration prerequisite /
§ 512 safe harbor / invalidity / inequitable conduct / preemption /
reverse-engineering / consent / license / laches / statute of limitations.
Flag each — do not opine.]

## What cuts which way — summary table

| Factor | Note | Direction (senior / accused / mixed) |
|--------|------|--------------------------------------|
| [factor 1] | [note] | [direction] |
| ... | | |

**Conclusion:** *This skill does not conclude.* Attorney judgment required before
acting. Factors cutting [direction]: [brief list]. Factors cutting [direction]:
[brief list].

## Recommended next steps

- [ ] [Obtain formal written opinion from IP counsel before any assertion or
      reliance on non-infringement]
- [ ] [Evidence preservation and litigation hold, if a clock is running]
- [ ] [Specific fact development needed — e.g., access logs, prosecution history,
      market studies, survey evidence, registration status]
- [ ] [Decision on posture: assert / respond / investigate further / watch and wait]
- [ ] [If asserting: separate skill or attorney drafting for C&D or takedown]

## Citation verification notice

Every case citation, statute, registration number, claim quote, and exhibit
cited here must be verified against authoritative sources before being relied
upon. Jurisdictional tests vary by circuit and evolve — confirm controlling
authority in the relevant circuit and check for recent decisions.
```

---

## Privilege and destination check

This triage output is attorney work product when prepared in connection with anticipated or pending litigation. Do not help the attorney paste privileged analysis into communications outside the privilege circle (e.g., emails to business clients without privilege framing, public filings, or counterparty communications). Flag if the destination is unclear.

---

## Routing to next steps

If the triage points toward assertion and the attorney wants to proceed, offer:

> Want me to help draft a cease-and-desist letter based on this triage? I can prepare a draft for your review — it won't go anywhere until you approve it.

Or, if the mode is copyright and the accused is hosted user content:

> Want me to help prepare a DMCA takedown notice? I can draft one for your review.

**Do not draft the letter automatically from the triage.** The decision to assert is the attorney's.

End every triage with a short decision tree:

> **Next step options:**
> 1. Draft the [C&D / takedown / response letter] — I'll prepare a draft for your review.
> 2. Develop more facts first — tell me what to search or what to analyze.
> 3. Get a formal written opinion from outside IP counsel.
> 4. Watch and wait — flag what would change the posture.
> 5. Something else — tell me.

---

## What this skill does not do

- **Conclude infringement or non-infringement.** Ever. This is the loudest guardrail.
- **Substitute for survey evidence, damages experts, or formal claim construction.**
- **Access Westlaw, CourtListener, USPTO PAIR, or patent databases directly** — web_search and attorney-provided documents are the available sources; the attorney must verify case law and prosecution history through authoritative databases.
- **Evaluate jurisdiction-specific defenses outside the stated jurisdiction scope.** Cross-border facts require jurisdiction-specific review; flag it.
- **Decide fair use as a matter of law.** Fair use is fact-intensive and reserved for the attorney and ultimately the court.
- **Draft the C&D, takedown, or complaint without attorney direction.** Those require attorney approval at each step.
- **Quote triage outputs to counterparties.** Work-product protection applies only if handled properly.
