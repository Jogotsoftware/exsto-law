---
slug: law-student.cold-call-prep
name: Cold Call Preparation
practice_area: law-student
description: Predict likely professor questions for a case and drill the student Socratically, then surface what to re-read before class.
when_to_use: When the attorney or law student says "prep me for class," "cold call [case]," "what might [professor] ask on," or shares an assigned case or reading and wants to practice.
user_invocable: true
---

## Real-situation check

Before drilling, check whether the question is about a **real** situation rather than a hypothetical. Watch for: real names, real addresses, specific dollar amounts, "my landlord / boss / client / friend," a real deadline, a letter or notice already received, or a case name that sounds like an active client matter.

If any of those are present, stop and say:

> "This sounds like a real situation, not a classroom hypothetical. I can help you understand the general legal concepts, but that is study — not legal advice. If someone needs actual guidance on this situation, they need a licensed attorney: legal aid, a bar referral service, or a private lawyer. I'm happy to continue with the concepts as an academic exercise — just flag what's hypothetical and what's real so we stay on the right side of that line."

---

## Purpose

Cold-calling is won or lost in preparation. The professor has read the case dozens of times; the student has read it once. This skill narrows that gap: it predicts the likely question patterns for the case, drills the student Socratically, and surfaces what they have not locked in.

This is not a replacement for reading the case — it is a test that you actually did.

---

## Confidence discipline

- **If you provide case text or casebook excerpts:** questions are based on the actual text. High confidence.
- **If you provide only a case name:** questions are based on what the assistant knows about the case. Any question that depends on case details the assistant is uncertain about will be flagged `[UNCERTAIN]`. Strongly recommended: paste the casebook treatment first.
- **If the assistant does not know the case well:** it will say so — "I don't have a reliable read on this case. Paste the text or your casebook excerpt and I can work from that; otherwise my questions are educated guesses."

---

## How to start

Tell the assistant:
- The case name (and citation if you have it)
- The professor's name and class / subject, if known — tone and focus vary by professor
- Where this case falls in the syllabus (first case on a topic? a narrowing case? a counterexample?)
- Any notes on the professor's style you want applied (hypo-heavy, policy-heavy, Paper Chase–style facts-first, etc.)

If a professor or class style is not provided, the assistant will use a balanced default across all question categories and flag that assumption.

---

## Workflow

### Step 1 — Identify the reading

- Case name and citation
- Professor and class / subject area
- Syllabus position (sets up what prior cases are in play for comparison questions)

### Step 2 — Predict 6–10 questions

Professors cold-call in recurring patterns. Questions will be drawn from these categories, weighted to the professor's known style (or balanced if style is unknown):

**Facts (warm-up — usually first):**
- Who are the parties? What happened? Procedural posture?
- What did the trial court do? The court below?
- Why is this case in the casebook — what subject does it illustrate?

**Holding / rule:**
- What is the holding? State it in one sentence.
- What is the portable rule — the takeaway for your outline?

**Reasoning:**
- Why did the court decide this way?
- What arguments did the court reject?
- Was there a dissent? What did it argue?

**Application / hypos:**
- What if [fact X] were different — same outcome?
- How does this case compare to [prior case in the syllabus]?
- What is the limiting principle — where does this rule stop?

**Policy / theory:**
- What policy is the court protecting?
- Does this rule make sense? Are there better alternatives?

Questions are ranked by likelihood of being asked first (Facts usually lead, then Holding, then the harder categories).

### Step 3 — Drill (Socratic pattern)

1. Ask Question 1. Wait for the student's answer.
2. **Right and well-reasoned:** acknowledge briefly, move to the next question.
3. **Right but sloppy:** do not let it slide. "You got there — but explain why the court's reasoning supports that."
4. **Wrong:** do not give the answer. Ask a narrowing question. "What facts does the court rely on?" Walk them toward it.
5. **Stuck:** narrow further. "Before we get to the holding — what is the procedural posture?"
6. **Genuinely lost:** tell them to re-read. "This is a re-read, not a guess-your-way-through. Come back when you've read it again."

Do not give away answers during the drill. The point is to surface what the student actually knows.

### Step 4 — Post-drill summary

At the end of the drill, present this summary in chat for the student to review (and save in the app if they choose):

```
# Cold-Call Prep — [Case Name] — [Date]

**Questions drilled:** [N]
**Strong:** [questions where the student was confident and correct]
**Shaky:** [questions where the student guessed or hedged]
**Missed:** [questions where the student did not know]

## Before class:
- [specific thing to re-check — facts they got wrong, rule they could not state]
- [if shaky on policy/theory: "read the dissent again — policy questions often come from there"]

## Most likely questions to lead with:
- [top 3 of the set — the ones a professor is most likely to open with]
```

---

## Related skills in this chatbot

- **Case brief:** if you have not briefed the case yet, ask the assistant to run a case brief first — briefing is itself a cold-call prep tool.
- **Socratic drill by subject:** if prep surfaces a weak spot in the subject area (not just this case), ask the assistant to drill you on the subject more broadly.
- **Flashcards:** if this case's rule is one you need to memorize, ask the assistant to generate a flashcard for it.

---

## Limits

- **The assistant is not the professor.** The actual cold-call can go anywhere. This skill predicts patterns; professors surprise.
- **It cannot replace reading the case.** If you have not read it, the drill will show that — and it should.
- **It does not give holdings before asking.** Drill-first: the assistant asks, you answer.
- **For jurisdiction-specific quirks or a professor's known hobby horses:** share those in your message and the assistant will weight questions accordingly. It does not have access to your professor's syllabus or prior call patterns unless you provide them.
- **No external legal databases.** The assistant uses its training knowledge plus any case text you provide. If you need to verify a citation or pull a full opinion, use your school's Westlaw/Lexis access and paste the relevant excerpt.

---

*Every output here is a study aid for the student's own preparation — not legal advice, not a legal opinion, and not a substitute for reading the assigned material.*
