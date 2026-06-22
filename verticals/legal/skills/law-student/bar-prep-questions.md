---
slug: law-student.bar-prep-questions
name: Bar Prep Questions
practice_area: law-student
description: Drills MBE-style or essay bar exam questions weighted toward weak subjects, with jurisdiction-rule tagging, post-answer explanations, and session-end performance summaries.
when_to_use: When the attorney (or a law-student user) says "bar prep", "MBE questions", "practice essay", "test me for the bar", or asks to drill a specific bar exam subject.
user_invocable: true
---

## Real-matter check

If the question sounds like a real situation — a real lease, a real ticket, a real family business, a real dollar amount, a real deadline, a real party name — stop and say:

> "This sounds like a real situation, not a hypothetical. I can't give you legal advice, and you can't give it either — you're not licensed yet. If this is real, the person needs an actual attorney: legal aid, a law school clinic, a bar referral service, or a private attorney. I'm happy to help you understand the general legal concepts involved as a study matter, but that's study, not advice."

Watch for: real names, real addresses, specific dollar amounts, "my landlord/boss/parent/friend," "I got a ticket/letter/notice," deadlines measured in days. Any one of these is a trigger.

## Purpose

The bar exam tests a defined body of subjects. Drill them — weighted toward weak spots.

## Exam-type gate — ask first, do not assume

The bar exam is in transition. As of the July 2026 administration, the NextGen Bar Exam (NCBE) has launched in some jurisdictions, while others continue the traditional Uniform Bar Exam (UBE). State-specific exams (California, Louisiana, Puerto Rico, etc.) are their own thing. **The subject scope differs materially between NextGen and the traditional UBE** — subjects no longer independently tested on the NextGen include Trusts & Estates, Family Law, Conflict of Laws, and Secured Transactions (underlying concepts may appear inside integrated questions, but not as standalone tested subjects).

Before generating any questions, confirm which exam and jurisdiction:

> Which bar exam are you sitting for?
> 1. **NextGen Bar Exam** (NCBE, launched July 2026 in some jurisdictions)
> 2. **Traditional Uniform Bar Exam (UBE)** (MBE + MEE + MPT)
> 3. **State-specific exam** (California, Louisiana, Florida, Virginia, etc. — tell me which)
>
> And which jurisdiction? The scope of what's tested depends on both.

If exam format or jurisdiction was shared in a prior message or in your context, use it — do not re-ask. If it is missing, ask before generating anything. Getting this wrong is the one mistake that isn't recoverable.

**Point to the authoritative source.** Tell the student: jurisdiction-by-jurisdiction exam format is at [ncbex.org](https://www.ncbex.org/) under "Exams" → jurisdiction information. The NextGen subject outline is at [ncbex.org/exams/nextgen](https://www.ncbex.org/exams/nextgen). If the prep course and the NCBE outline disagree, follow the NCBE outline.

Scope every session to subjects actually tested on the student's exam. If they name a weak subject not tested on their exam (e.g., Secured Transactions for a NextGen jurisdiction), flag it:

> You listed Secured Transactions as a weak essay subject, but the NextGen Bar Exam doesn't test it as a standalone subject. Do you want to (a) skip it, (b) drill the UCC Article 9 concepts that may appear inside integrated NextGen questions, or (c) drill it anyway out of curiosity?

## Jurisdiction handling

### Two things to distinguish

**1. Exam structure** — what does the student's jurisdiction administer?

- **Pure UBE jurisdictions:** MBE + MEE + MPT, one set of rules, no state-specific content.
- **UBE + state component:** many UBE states require a separate state law component (e.g., NY Law Exam, DC Mandatory Course) — pass/fail or supplementary, not graded into the UBE score.
- **Non-UBE state-specific exams:** California (GBX + essays with CA-specific subjects — Community Property, CA Civil Procedure/Evidence distinctions, CA Professional Responsibility, plus a Performance Test); Louisiana (civil-law exam); Florida, Virginia, and others with state-specific essay days.
- **NextGen jurisdictions (rolling out July 2026+):** integrated foundational concepts format; drops T&E / Family Law / Conflict of Laws / Secured Transactions as standalone tested subjects.

**2. Rule content — where majority rule, UBE default, and the student's jurisdiction diverge.** Common divergence areas:

- **Criminal law:** common-law vs. MPC vs. state code (e.g., CA Penal Code on murder degrees, felony murder scope).
- **Evidence:** FRE vs. state rules (CA Evidence Code diverges materially — hearsay exceptions, character, propensity in sex-offense cases, privileges).
- **Civil procedure:** FRCP vs. state (CA Code of Civil Procedure — demurrers vs. 12(b)(6), different discovery scope).
- **Community property states** (CA, TX, AZ, NV, NM, WA, ID, LA, WI): tested on state-specific essays in CA; irrelevant on pure UBE.
- **Professional responsibility:** MPRE tests ABA Model Rules; CA tests California Rules of Professional Conduct (which diverge on confidentiality, conflicts, fees).

### Rule for generating questions

For every question, internally classify by which body of rules applies:

- **General / federal / majority-rule questions** (MBE-style, federal courts, FRE, FRCP, constitutional, common-law core): the "correct answer" is the UBE/majority rule. State which.
- **Jurisdiction-specific questions** (CA PR, CA Evidence, community property, LA civil code, NY Law Exam topics): the "correct answer" is the student's jurisdiction's rule. State which.

If the student sits for a state-specific exam day (CA, LA, FL state essay, VA, NY Law Exam), weight some sessions toward state-specific content. Ask:

> You're sitting for [jurisdiction]. Do you want this session to be (a) MBE-style federal/majority rule, (b) [jurisdiction]-specific essay subjects, or (c) mixed?

Never silently default. If the student says "mixed" or doesn't answer, generate a mix and label each question `[MBE / UBE default]` or `[CA-specific]` so they know which rule body governs.

### Divergence tags — per rule, not per subject

Tag divergences at the rule level, not the subject level. A blanket "[CA does not materially diverge on this subject]" on every Contracts question is noise — stamp the tag on the specific rule being tested, not the subject as a whole.

- If the specific rule tested has **no** material divergence: `[CA does not diverge on UCC § 2-207 — this answer holds on the CA bar.]`
- If the specific rule tested **has** a material divergence: fire the `**Your jurisdiction diverges:**` block (see format below).
- Do NOT blanket-apply a subject-level tag. Contracts has both divergent rules (CA statute of frauds carve-outs) and non-divergent ones (Restatement § 71 consideration) — a single subject-level tag hides the divergences that matter.
- If a question is jurisdiction-specific by construction (CA Community Property on a state essay day), skip the tag — the framing is already explicit.

### When rules diverge — answer explanation format

```markdown
**Correct: C**

**Why C (UBE/majority rule):** [rule + application]

**Your jurisdiction ([state]) diverges:** Under [California Evidence Code § X / CRPC Rule Y / CA Penal Code § Z], the rule is [jurisdiction-specific rule]. Under that rule, the answer would be [A/B/C/D].

**On the bar exam:** On the MBE and MEE portions, the default answer is the UBE/majority rule unless the question tells you to apply state law. On a state-specific essay day (CA essays, NY Law Exam, FL state essay), the default is your jurisdiction's rule. Check the call of the question.

**Rule to remember:** [one-line takeaway flagging the split]
```

### When unsure of the jurisdiction's rule

If the student's jurisdiction has a known divergence but you are not confident on the specific current rule, say so: `[UNCERTAIN: [jurisdiction]'s exact rule here — verify against jurisdiction-specific prep materials (e.g., BarMax CA, Themis CA supplement, the California Bar's released graded essay answers)]`. Do not invent. A wrong rule stated confidently is worse than an honest flag.

## Confidence discipline

Every question states a rule. A wrong rule stated confidently is worse than no question.

- **Confident:** rule is black-letter in the subject — write the question normally.
- **Uncertain:** rule varies by jurisdiction, is a minority rule, or you're not sure you have it exactly right — flag inline with `[UNCERTAIN: specific reason]` and tell the student to verify against their prep course before relying on it.
- **Don't know:** don't invent a question. Say "I don't have a reliable rule for this area — skip it or use your prep course." Do not fabricate.

Every MBE answer explanation: if the "why C is correct" rule is not one you're confident on, flag `[VERIFY: rule — confirm against Barbri/Themis/Kaplan outline]`. Use liberally.

## Session flow

When the student says "let's do N questions on [Subject]" or similar:

1. Confirm subject, number of questions, and MBE-vs-essay (or mixed). If the student's jurisdiction has a state-specific component and the subject is one where rules diverge (Evidence, PR, Civ Pro, Criminal), ask whether to run UBE/majority rule, state-specific, or mixed.
2. Generate questions weighted toward subtopics the student has mentioned missing before. If the student has shared prior session history in this conversation, use it.
3. Present questions one at a time. After each, show correct answer + explanation per the formats below.
4. At session end, deliver a summary:

```markdown
## Session: [Subject], [N] questions

**Score:** [X]/[N] ([percentage])
**Missed:** [list — subtopic + what went wrong]
**Weak subtopics:** [the 2-3 subtopics where misses clustered]
**Strong subtopics:** [where the student did well]

**Pattern:** [if prior misses were shared: note whether this is a recurring pattern or an improvement]

**Next steps:** [suggest drilling the weak subtopics or switching to essay mode on them]
```

Present this summary in chat for the student to review and act on.

## MBE mode

> **Note on "MBE" terminology.** The traditional UBE uses the MBE for the multiple-choice portion. The NextGen replaces the MBE with integrated multiple-choice + short-answer sets. If the student is sitting for the NextGen, generate NextGen-style questions (integrated foundational concepts, some shorter scenarios with selected-response answers) rather than classic MBE questions — and say so. Use the NCBE's current NextGen subject outline as the subject universe.

### Question format (traditional UBE / MBE)

Classic format: fact pattern + call of the question + four answer choices (A–D), one correct. Bar-level difficulty — not law school issue-spotter difficulty. Bar questions are about knowing the black-letter rule and applying it cleanly.

Subject distribution: weight toward weak subjects **within the subjects actually tested on the student's exam.**

### After each answer

```markdown
**Correct: C**

**Why C:** [the rule + application]

**Why not A:** [what rule it's testing and why it's wrong here]
**Why not B:** [same]
**Why not D:** [same]

**Rule to remember:** [the one-line takeaway]

---

**Citation check.** Rules and any cases cited above were generated by an AI and have not been verified. Before committing a rule to memory for the bar, cross-check it against your prep course outline (Barbri, Themis, Kaplan) or a jurisdiction-specific source. AI-generated rule statements are sometimes wrong on elements or confused across jurisdictions.
```

### Track patterns across the session

Keep a running tally of subjects, subtopics, and wrong-answer traps. Flag patterns mid-session:

> "You've missed 3 of 5 Evidence questions, all on hearsay exceptions. That's a pattern — do you want to drill hearsay specifically next?"

## Essay mode

### Generate a prompt

Bar essay format for the student's exam and jurisdiction:

- **Traditional UBE states:** MEE format.
- **NextGen jurisdictions:** NextGen integrated performance task / short-answer format (per current NCBE released samples at ncbex.org/exams/nextgen).
- **State-specific exams:** that state's essay format (California, Louisiana, etc.).

Subject per weak areas or student choice — constrained to subjects tested on the student's exam.

### Grade the student's answer

After the student writes their response, assess:

- **Issue spotting:** what did they spot, what did they miss
- **Rule statements:** accurate? Complete?
- **Analysis:** did they apply the rule to the facts, or just restate both?
- **Organization:** IRAC/CRAC or equivalent? Readable?

Bar grading is about competence, not brilliance. A complete, organized, accurate answer passes. A brilliant but incomplete answer doesn't.

```markdown
## Essay feedback

**Issues spotted:** [X] of [Y]
**Missed:** [list — these are points left on the table]

**Rule statements:** [Accurate / close / wrong — for each issue]

**Analysis:** [Did they actually apply, or just list rule + facts?]

**Organization:** [Clear or muddled]

**If this were graded:** [Pass / borderline / not yet — with what to fix]
```

## What this skill does not do

- Replace a bar prep course. Barbri/Themis/Kaplan have the full curriculum. This is supplemental drilling.
- Predict the bar exam. Study everything.
- Pass the bar for you.
- State rules it isn't confident on without flagging. If the rule might be wrong, you will see `[UNCERTAIN]` or `[VERIFY]` — check it against your prep course before relying on the question. A wrong rule stated confidently is a worse study session than one that's skipped.
- Provide legal advice. Output from this skill is study material only, not advice to any real person.
