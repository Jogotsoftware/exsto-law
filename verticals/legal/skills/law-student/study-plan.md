---
slug: law-student.study-plan
name: Bar Exam and Law School Exam Study Plan Builder
practice_area: law-student
description: Builds or updates a phased, adaptive study plan for the bar exam or a law school exam — weighted by weak subjects, with a realistic daily/weekly schedule, cram-mode support, and session-history adaptation.
when_to_use: When the user says "build a study plan", "plan my bar prep", "schedule my studying", "how should I study for [exam]", "update my study plan", "what should I study today", or asks for a cram schedule.
user_invocable: true
---

## Real-situation check

If the request sounds like a real client matter — real names, real deadlines, real dollar amounts, real adverse parties — stop and say:

> "This sounds like a real situation rather than a study exercise. I can help you understand the general legal concepts as a study matter, but I cannot give you legal advice, and you cannot give it either while you're unlicensed. If someone needs actual legal help, they should contact a licensed attorney, a legal aid organization, or a law school clinic. I'm happy to continue with the study plan itself."

---

STUDY NOTES — NOT LEGAL ADVICE

---

## Purpose

Sitting down to study without knowing what to study is how weeks disappear. This skill builds a plan — weeks to exam, sessions per day, subjects per week, session types — and then adapts as you complete sessions and report results. It is a living plan, not a one-time export.

## Step 1 — What are we planning for?

Ask the user which of these applies, then wait for the answer:

1. **Bar exam** — a bar date is in mind (or upcoming)
2. **A specific law school exam or finals period** — one class or a set of classes, with a date
3. **General semester study cadence** — outlining, reading, and drilling across all classes through the end of term

For **bar exam**: confirm the jurisdiction. The subject scope and exam format differ materially by jurisdiction. As of the July 2026 administration, some jurisdictions have adopted the NextGen Bar Exam (NCBE), while others continue the traditional Uniform Bar Exam (UBE) or a state-specific exam. Ask which applies if not already known — **default to the North Carolina UBE if the user does not specify a jurisdiction, and surface that assumption explicitly**.

For **law school exam**: ask which class, what date, and what format (closed book, open note, essay, multiple choice, or mixed).

For **semester cadence**: ask for the term-end date as the anchor.

## Step 2 — Gather inputs one at a time

Ask these questions one at a time. Wait for each answer before asking the next. Do not bundle them into a single prompt.

1. **Exam date** — confirm or ask. How many weeks out is it?
2. **Subjects to cover** — for the bar, use the NCBE subject outline for the applicable exam format. For a class, the syllabus. Confirm: "Any subject I should add or drop?"
3. **Strongest subjects** — these get lighter coverage; still reviewed, not drilled heavily.
4. **Weakest subjects** — these get the most time and sessions.
5. **Hours per week available** — ask for a realistic number, not an aspirational one. "I can do 20 hours" is different from "I will sustain 20 hours for 8 weeks."
6. **Life-context check — do not skip.** After the user gives a weekly hour number, ask:

   > "You said [N] hours per week. Before I build this, tell me what else is in your week — job (hours/week), family, caregiving, commute, workouts, any clinic or externship commitments. A plan that fits your life beats an ambitious plan you abandon in week 3."

   Wait for the answer. Then sanity-check the stated hours against their reported load and respond honestly: is that number realistic, tight, or unsustainable? If the check suggests a lower number, use the lower number and flag the adjustment.

   If the user declines to share life context ("just build it"), respect that — but flag it: "Life-context check was skipped; this plan assumes [N] hours/week is sustainable. Revisit at the end of week 2 if adherence is low."

7. **Preferred study methods** — MBE practice questions, essays, flashcards, outlining, re-reading. Weight the schedule toward methods they say they'll actually do.
8. **Days off per week** — rest days matter. Plans that schedule 7/7 days fail by week 3.

## Step 2.5 — Prep course: supplement or replace?

If the user mentions they are on a structured prep course (Barbri, Themis, Kaplan, or similar), ask one question and wait:

> "You mentioned you're on [prep course]. They publish a day-by-day schedule. Two roles this plan can take — pick one:
>
> 1. **Supplement.** The prep course is your primary curriculum. This plan adds extra drilling on your weak subjects and targeted essay practice, layered on top of the prep course. I won't rebuild their calendar.
> 2. **Replace.** You're not following the prep course calendar (maybe the pacing doesn't work). I'll build the whole plan and you drop their calendar.
>
> Running both in full parallel is how students burn out by week 4."

Record the answer as `supplement` or `replace` and carry it through the plan.

If **supplement**: the plan only adds weak-subject drilling and targeted practice, and you note: "This plan assumes you're on track with [prep course] for primary coverage. If you fall behind on the prep course, let me know and we'll re-plan."

If **replace**: build the full plan as below.

If no prep course is mentioned, skip this step.

## Step 3 — Build the schedule

Calculate weeks to exam from today's date (if you do not know today's date, ask the user to confirm it). Then:

### Normal mode (4 or more weeks out)

Split weeks into three phases:

- **Learning phase** (~60% of remaining time): one subject per 3–5 days, mixing outlining/reading with flashcards and a light set of practice questions on fresh material.
- **Drilling phase** (~30%): higher MBE volume, more essay practice, simulated timed conditions, all subjects in rotation.
- **Review phase** (~10%): focused on the weakest subtopics from reported session results, full practice exams, light touch on strong subjects. Schedule no hard drilling the last 2–3 days before the exam — students who cram through the final night score worse.

Weight subjects by weakness: weak subjects get approximately 2× the hours of strong subjects.

Build a day-by-day schedule for the first two weeks. Beyond that, allocate by week and note that you will fill in the daily schedule as sessions are reported.

### Cram mode (fewer than 4 weeks out, or user-requested)

Flag it clearly:

> "You're [N] weeks out. This is cram mode. The plan prioritizes high-yield topics over full coverage. You will leave gaps — that is the tradeoff at this point."

Then:
- **80/20 prioritization**: MBE subjects that have historically appeared most — Civil Procedure, Evidence, Constitutional Law, Contracts — get the lion's share. Narrower subjects get minimum viable coverage. Flag: "High-yield prioritization is based on historical subject frequency — past frequency is not a guarantee of what will be tested this cycle."
- **Daily structure**: MBE question blocks every day (volume matters in cram mode), essay practice every other day, at least one full simulated exam per week.
- **Taper the last 2–3 days**: light review only. No new material. No all-nighters.

## Step 4 — Present the plan for review

Before treating the plan as set, summarize it in prose and ask the user to confirm. Lead with the required header:

> **STUDY NOTES — NOT LEGAL ADVICE**
>
> Here's what I built. [X] weeks to the [exam]. [Y] hours/week across [Z] days. Weak subjects ([list]) get 2× the hours. Three phases: learning through [date], drilling through [date], review the last [N] days. The first two weeks are scheduled day-by-day; beyond that I've allocated by week and will fill in daily detail as you report sessions.
>
> Does this feel right? Too ambitious? Too light? Missing a subject?

Adjust based on the answer before finalizing.

Present the plan in chat for the user to review and save in the app if they choose. You do not write files.

## Step 5 — Updating the plan

When the user asks to update their plan or reports that they have completed a session, ask what they covered, how long they studied, and — for practice questions — how many they got right and which subtopics felt weakest. Use that to:

- Promote subjects with consistently low scores to higher priority.
- Flag weak subtopics within a subject for the next scheduled session on that subject.
- If the user is falling behind (sessions aren't happening as scheduled), acknowledge it without judgment and adjust: either compress coverage, consolidate subjects, or note the gap and ask how to handle it.
- If the user is ahead of schedule, open up time for deeper drilling on weak subjects.

When the user asks "what should I study today" or "what's on deck this week," recall the plan from context (or ask the user to paste it) and answer from the schedule — do not ask them to rebuild from scratch.

## Confidence discipline

State estimates as estimates:

- **Time-per-topic estimates** are general guidance based on typical prep-course weightings. The user's actual pace will differ.
- **Subject weightings** come from the user's own reported weak subjects and session feedback. These are reliable once given.
- **High-yield-topic prioritization in cram mode** is based on historical subject frequency. Always flag: "Past frequency is not a prediction of what will appear on your specific administration."
- **Weeks-to-exam arithmetic** is only as accurate as the exam date the user provides. Confirm the date if there is any ambiguity.

## What this skill does not do

- **Guarantee you pass.** The plan is a scaffold. The work is on you.
- **Predict the exam.** Cram mode uses historical frequency data — that is not a promise about what will be tested.
- **Replace your prep course calendar.** If you are on Barbri, Themis, or Kaplan, this plan supplements — it does not run a full parallel curriculum. Running both in full is a burnout path.
- **Schedule your life.** Hours available is what you tell the assistant. If you overstate it, the plan will break in week 2. Be honest.
- **Give legal advice.** This skill helps a student study law. It does not advise clients, and the student cannot advise clients either.
