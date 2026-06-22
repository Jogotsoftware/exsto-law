---
slug: law-student.exam-forecast
name: Law School Exam Forecast
practice_area: law-student
description: Analyze past exams from the same professor to surface stable patterns — subject weighting, recurring traps, question style, policy-vs-doctrine ratio — and produce a study-emphasis forecast for the upcoming exam.
when_to_use: When a law student shares past exams and asks what is likely on the upcoming exam, asks to "analyze past exams," wants a "predict the exam" breakdown, or asks how to allocate study time before a final.
user_invocable: true
---

## Purpose

Every professor's exam has fingerprints. The same hypo structures recur. The same traps come back. The same subject ratios repeat. Students who have prior exams study smarter; students who don't, study harder. This skill analyzes the prior exams the attorney or student shares and surfaces the patterns.

This is a forecast, not a prediction. You cannot tell the student what will be on the exam — you can tell them what has been on past exams and what is likely to recur based on syllabus coverage. Frame all outputs accordingly.

---

## Confidence discipline

- Pattern analysis (which subjects appeared, how many questions per topic, policy vs. rule-application ratio): state confidently where the exams are clearly provided.
- Inference about likely emphasis on the upcoming exam: default to `[UNCERTAIN]` framing. Use language like "based on the [N] past exams you shared, [topic] appeared in [M of N]. Your upcoming exam may emphasize it, or the professor may rotate — treat this as a weighting heuristic for study time, not a certainty."
- If only 1–2 past exams are available, flag this explicitly — any pattern inferred from a single exam is noise.
- If no past exams from this professor are available, say so clearly. Fall back to syllabus-based coverage only ("here are the topics the syllabus covers; study all of them").

---

## Step 1 — Intake

Ask (or infer from what the student has shared) the following. Do not ask for information already visible in the materials.

- Which class and professor?
- How many past exams from this professor are available? Paste them, upload them, or describe them.
- Are they from the same course, or different courses by the same professor?
- Are any of them a different format variant (take-home, open-book) compared to the upcoming exam?
- Do you have the syllabus for the current class?

If fewer than 3 past exams: flag as thin sample. Pattern inference is weaker; say so in the output.

If exams are from different courses by the same professor: some patterns transfer (question style, policy vs. doctrine ratio); subject-specific patterns generally do not.

If a professor's name appears in the uploaded materials, use it — do not ask the student to retype it.

---

## Step 2 — Analyze each past exam

For each past exam provided, identify:

- **Format:** number of questions, length, time limit, open/closed book
- **Subject coverage:** which topics tested, in what proportion
- **Question style:** issue-spotter, single-issue deep, policy essay, short-answer MBE-style, or mix
- **Fact-pattern density:** fact-heavy hypos vs. sparse facts with doctrinal focus vs. policy prompts with no facts
- **Recurring traps:** e.g., "professor always hides the jurisdictional issue in an otherwise-clean fact pattern"; "always asks about the exception rather than the rule"
- **Policy vs. doctrine ratio**
- **Unusual structures:** essays + MBE hybrid, moot court scenario, etc.

---

## Step 3 — Cross-exam pattern analysis

Roll up what is consistent across exams.

**Stable patterns (appeared in most or all past exams):**
- Subject weights (e.g., "consideration and modification account for roughly 30% of exam points consistently")
- Question style (e.g., "always one long issue-spotter + two short-answer hypos")
- Professor hobby horses (e.g., "always tests third-party beneficiaries even when it is a minor topic in class")

**Variable patterns (appeared in some but not all):**
- Policy essays (e.g., "appeared in 2 of 4 past exams — usually when the semester covered a policy-heavy topic late")
- Open-book vs. closed-book differences

**Absent patterns worth noting:**
- Topics covered in class that have never been tested — do not tell the student to skip these; just weight them lighter
- Topics tested in past exams that are not in the current syllabus — probably not coming back

---

## Step 4 — Forecast output

Present the forecast in chat using the template below. The student can copy or save it from the app if they choose.

Every forecast must open with this exact header on its own line — do not omit, rephrase, or relocate it:

```
STUDY NOTES — NOT LEGAL ADVICE
```

```markdown
STUDY NOTES — NOT LEGAL ADVICE

# Exam Forecast — [Class / Professor] — [Date]

**Past exams analyzed:** [N]
**Sample confidence:** [thin (<3) / moderate (3–5) / strong (6+)]
**Caveats:** [e.g., "One past exam was open-book; your upcoming is closed-book. Pattern transfer is partial."]

---

## Subject weighting (historical)

| Topic | Past exam weight (avg) | In current syllabus? | Forecast weight |
|---|---|---|---|
| [topic 1] | [%] | [yes / partial / no] | [heavier / stable / lighter] |

## Question-style forecast

- **Format likely:** [X issue-spotters + Y short answers + Z policy, or similar]
- **Fact-pattern density:** [fact-heavy / sparse / mixed]
- **Call style:** [one broad call / multiple specific calls / bullet sub-parts]

## Professor hobby horses to watch

- [Topic A] — appeared in [M of N] past exams. Weighted well above its syllabus share.
- [Topic B] — [pattern]
- [Trap pattern] — e.g., "hides the jurisdictional issue in otherwise-clean facts"

## Topics covered this semester but rarely tested

[List — do not skip these; just weight them lighter]

## Study emphasis recommendation

Based on past exam patterns AND current syllabus coverage:

**Heavy:** [topics likely to anchor the exam — 40–50% of study time]
**Moderate:** [supporting topics — 30–40%]
**Sanity check:** [topics covered but historically under-represented — 10–20%, just in case]

## [UNCERTAIN — framing note]

This forecast is derived from [N] past exams. Professors vary. Professors rotate. Topics emphasized in past years can be de-emphasized when the syllabus shifts. Treat this as a weighting heuristic for study time, not a prediction. The exam will include surprises.
```

---

## Jurisdiction and default assumptions

Where the class involves jurisdiction-specific doctrine (choice of law, conflicts, local procedure), default to **North Carolina / federal common law** if no jurisdiction is stated, and surface that assumption explicitly. If a past exam references a different jurisdiction, note it.

---

## What this skill does not do

- **Predict specific questions.** Past exams show patterns; they do not reveal tomorrow's prompt.
- **Work without past exams.** With no prior exams from this professor, fall back to syllabus-based coverage only.
- **Replace studying the full syllabus.** Forecast is weighting, not elimination. Skipping a topic because it is historically under-represented is how students get burned.
- **Account for mid-year shifts you do not know about.** If the professor emphasized a new case in lectures this semester, the forecast does not see that unless the student tells you.
- **Access Westlaw, course databases, or external exam banks.** If the student can share past exams as uploads or pasted text, use them. Otherwise note the gap and use what is available.

---

## Next steps

End the forecast by offering the student clear next-step options:

1. **Build an outline** — use the subject weights above to decide depth; heavier topics get more depth.
2. **Generate IRAC practice hypos** — use the forecast-heavy topics as subject areas.
3. **Generate flashcards** — prioritize cards for forecast-heavy topics.
4. **Update the forecast** — if you obtain additional past exams, share them and re-run.
5. **Something else** — the student can ask a follow-up question about any topic in the forecast.
