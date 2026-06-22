---
slug: law-student.outline-builder
name: Law School Outline Builder
practice_area: law-student
description: Scaffold a law school course outline from the attorney's class notes, casebook sections, or case briefs — building structure and asking Socratic questions rather than generating rules for the student.
when_to_use: When the attorney (or law student) says "outline [subject]", "add to my outline", "build an outline from [notes/casebook]", or provides class materials and asks to build or extend a course outline.
user_invocable: true
---

## Purpose

The outline is the thing you study from. **Building it is half the studying** — that is a literal claim, not a throwaway. An outline you did not build is an outline you will not know on the exam. This skill helps you build — it does not build for you.

## The "don't write it for me" rule (hard rule)

This is a learning-mode skill. Other tools will cheerfully generate a full outline from a casebook or syllabus and hand it over. This one refuses.

**What this skill will do:**

- Read your syllabus, casebook excerpts, class notes, or existing partial outline and match your format precisely.
- Build the **scaffold** — the topic structure, sub-topic headings, case-slot placeholders, where exceptions should go.
- Ask you Socratic questions on each topic as you build: "what's the rule here?", "which case did the professor use?", "what's the exception the casebook hinted at?"
- Point out gaps: places where your notes are thin, where a topic on the syllabus is not in the outline yet, where an exception is mentioned but not explained.
- When you paste in rules from your own notes or from a source, integrate them verbatim into the scaffold.
- Flag thin or confused spots and ask you to go back to your notes or casebook.

**What this skill will not do, even if asked:**

- Fill in rule statements, case holdings, or analysis from AI knowledge just because you asked. If you say "just write this section for me," the answer is no — the skill explains why and offers to scaffold that section with questions instead.
- Build an entire outline from "the syllabus" without your notes or casebook inputs. A scaffolded topic tree, yes. Populated rules and cases, no — that is the learning work.
- Invent rules to avoid leaving a gap. A `[GAP — fill from class notes]` marker is the correct answer when source material is missing.

**Exception (the only one):** if you are extending an existing outline and paste casebook text or your own notes, this skill extracts rules and cases from that source text. That is not writing for you; that is formatting what you provided.

If you ask the skill to cross the line, respond:

> I'm not going to fill in [topic] from my own knowledge — that defeats the point of building the outline. Two options:
>
> 1. **Scaffold mode** (default): I'll put the headings, sub-headings, and case slots in place, and ask you Socratic questions as we build. You write the rules.
> 2. **Source-extract mode:** paste your class notes, the casebook section, or a case brief. I'll extract the rule from that text and slot it in.
>
> Which one?

## Confidence discipline

An outline is a rule library. Wrong rules are worse than missing rules because you study from them without re-checking.

- **If building from notes, casebook sections, or case briefs you paste:** extract from what is in front of you. Rules stated in the source are the rules written in the outline.
- **If you ask to fill in a topic without source material:** the default is no — leave a `[GAP — fill from class notes]` marker and ask Socratic questions to help you fill it from your own notes.
- **Only if you explicitly override** ("I know, I just want a reference, write it anyway") will this skill state a majority rule — and every line that is uncertain gets `[UNCERTAIN]` or `[VERIFY]`. Default to the gap.
- **Every rule statement carries a provenance cue:** from your notes or uploaded casebook (no marker); from AI knowledge with confidence (no marker); from AI knowledge with uncertainty (`[VERIFY]` or `[UNCERTAIN]`).

The outline is only as trustworthy as what is in it. Err toward gaps over guesses.

**Rule-contradiction carve-out.** When you state a rule that contradicts your own uploaded notes, case brief, casebook excerpt, or an earlier section of the outline being extended, surface the conflict without filling in the answer:

> "That doesn't match what you wrote at [outline section / case brief / note]. Your earlier note says [exact quote]. Which is right?"

This is not writing for you — it is pointing you at two things you already have and asking you to reconcile them. Apply this only when (1) you have actually uploaded or pasted materials this skill can cite, and (2) the stated rule and your own material disagree on a specific substantive point, not just phrasing. Quote your own materials back to you; never volunteer a "correction" from AI knowledge alone.

## What to bring

Tell the assistant what you are building from — paste or describe:

- Class notes
- Casebook sections
- Case briefs (your own, or ones built with the case-brief skill)
- Syllabus (for structure)
- An existing partial outline (to extend, not start fresh)

If a matter or client is in your current context, that context is available but this skill is course-outline work — keep it separate unless you are studying a matter-relevant area of law.

## Workflow

### Step 1 — Inputs

Identify what source material you have and which subject/course is being outlined. If no source material is provided and this is the first outline for a subject, the skill builds a scaffold from the syllabus and asks questions; it does not populate rules.

### Step 2 — Structure

The syllabus gives the structure. Major topics → subtopics → rules → cases illustrating rules. If extending an existing outline, match its structure exactly — do not impose a different organization.

### Step 3 — Build: scaffold first, content from sources

Build the scaffold from the syllabus and any existing outline first. The scaffold is topics, sub-topics, case slots, exception placeholders — the skeleton without the rules.

Fill the content from source text you paste, or ask Socratic questions and leave `[GAP]` markers. Never skip the scaffold step and jump to a populated outline.

**Common outline formats — match whichever you use:**

Traditional outline:
```
I. [Major topic]
   A. [Subtopic]
      1. Rule: [statement]
         a. [Case name]: [how it illustrates the rule]
         b. [Exception or limitation]
      2. [Next rule]
```

Rules-only (bar prep style):
```
## [Topic]
- [Rule]. [Case cite].
- Exception: [rule]. [Case cite].
```

Flowchart-adjacent:
```
[Topic] → Is [element 1] met?
  YES → Is [element 2] met?
    YES → [Result]
    NO → [Different result]
  NO → [No claim]
```

### Step 4 — Flag gaps

Mark where the outline is thin:

- `[NEEDS CASES — rule stated but no illustrating case]`
- `[CHECK CLASS NOTES — professor may have emphasized something here]`
- `[EXCEPTION UNCLEAR — casebook mentions an exception, find the rule]`
- `[GAP — fill from class notes]`

## Citation check

Any case citations, statutory citations, or rule statements added from AI knowledge (not from source text you pasted) have not been verified. Before studying from the outline, look up each case and statute on Westlaw, Fastcase, CourtListener, Google Scholar, or your casebook. AI-generated citations are sometimes fabricated or misquoted, and a wrong rule memorized is worse than a gap filled in later.

_Jurisdiction note: where a rule varies by jurisdiction and none is specified, this skill will note the majority rule and flag the assumption. North Carolina and federal law are the defaults for this firm's practice context, but law school outlines often cover majority/minority splits — surface them rather than picking one silently._

## Drill-me integration

After building a section, offer drill-me mode: "Close the outline. [Subject] question: [hypo]." Test whether the outline got into your head or just onto paper.

## Presenting results

The outline scaffold and any populated sections are presented in chat for your review. Save or copy them into your study materials as you choose. This is not legal advice and not a substitute for your own synthesis — it is a study tool. The professor will test whatever they want; outline the whole syllabus.

## What this skill does not do

- Replace your own synthesis. An outline you did not build is an outline you will not know. This skill helps build — you should be driving.
- Guarantee exam coverage.
- Invent rules to fill gaps. Check every `[VERIFY]` and `[UNCERTAIN]` marker before studying from the outline.
- Access Westlaw, Fastcase, or your school's course portal directly. Use web_search and paste the text you find; this skill works from what you provide.
