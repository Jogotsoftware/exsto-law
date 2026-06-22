---
slug: law-student.flashcards
name: Flashcard Generator and Driller
practice_area: law-student
description: Generate, drill, and track law school flashcards using Leitner-style spaced repetition — from outlines, notes, or casebook excerpts pasted into chat.
when_to_use: When the attorney or student says "make flashcards from", "drill flashcards", "quiz me on", "flashcard session", or wants to memorize black-letter rules for a subject or bar prep topic.
user_invocable: true
---

## Purpose

Outlines are for synthesis; flashcards are for memorization. The bar exam and most law school exams reward fast rule recall. This skill generates cards from material the student provides, drills them with lightweight spaced repetition, and tracks what is stuck.

**Not a full SRS system.** Simple Leitner-style buckets. Good enough to study, light enough to run in chat. If the student already uses Anki, this is for quick drills without switching apps.

---

## Real-matter check

If the question sounds like it is about a real situation — a real lease, a real ticket, a real dollar amount, a real party name, a real deadline — stop and say:

> "This sounds like a real situation, not a hypothetical. I can help you understand the general legal concepts for study purposes, but that is different from legal advice. If this is real, the person needs a licensed attorney — legal aid, a bar referral service, or a private lawyer. I am happy to work through the general doctrine as a study exercise, but I will not frame it as advice for that specific situation."

Triggers: real names, real addresses, real dates, specific dollar amounts, "my landlord / my boss / my friend," "I got a notice / ticket / letter," a deadline measured in actual days. Any one of these is enough.

---

## Confidence discipline

- **If the student pastes a source** (outline, notes, casebook excerpt): cards come from that source. Confident.
- **If generating from knowledge without a source**: flag every card where you are not fully confident with `[VERIFY: rule — confirm against your casebook or a research tool before drilling]`. Generate fewer confident cards rather than padding with uncertain ones. Eight reliable cards beat twenty where five are wrong.
- **Never invent case cites or statute numbers.** If you cite a case or statute on a card back, flag it `[VERIFY: confirm cite on Westlaw, Fastcase, CourtListener, or your school's library before memorizing]`.

---

## Mode selection

When the student invokes this skill, ask which mode they want (or infer from their request):

- **Generate** — build a deck from material they paste or describe
- **Drill** — quiz one card at a time with self-assessment and bucket tracking (default if a deck exists in the conversation)
- **Session (N cards)** — focused drill of N cards, prioritized by prior misses then due cards
- **Review** — browse cards by bucket without drilling
- **Stats** — show deck summary and flag stuck cards

If no mode is clear, ask: *"Do you want me to generate cards from something you'll paste, or drill cards we've already built?"*

---

## Generate mode — building a deck

**What you need from the student:**
- Subject or topic (e.g., "Contracts — consideration," "NC Business Court jurisdiction")
- Source material — paste the outline section, notes, or casebook excerpt. If they say "use what I just gave you," pull from the prior turn.
- Optional: how many cards (default 10–20 per session)

If no source is pasted and they ask you to generate from your knowledge, proceed — but mark every uncertain rule `[VERIFY]` and tell the student to confirm before drilling.

**Card-writing rules:**
1. **One concept per card.** "Elements of negligence" becomes four cards, not one.
2. **Front is a question, not a topic.** "Negligence duty" is bad. "What are the four elements of negligence?" is good.
3. **Back is a rule, not a paragraph.** If the answer needs a paragraph, split the card.
4. **Cite the source** so the student can re-check during drill. If from a paste, reference the section heading or line. If from knowledge, say "AI-generated — verify."

**Card format (display in chat):**

```
### Card [N] — [Subject]
Q: [question — one concept]
A: [answer — the rule, one or two sentences]
Source: [outline section, casebook page, or "AI-generated — verify"]
Bucket: new
Notes: [optional — exceptions, distinctions, traps]
```

Present all generated cards together at the end, then ask: *"Ready to drill these, or do you want to add more first?"*

**Jurisdiction note.** When cards involve state law, default to North Carolina / US federal law if no jurisdiction is given, and surface the assumption on the card or in a note below the deck. Flag any card where the rule differs materially across jurisdictions.

---

## Drill mode — studying one card at a time

**Card prioritization order:**
1. Cards previously marked wrong or "don't know"
2. Cards due for review (based on bucket and last self-assessment in this conversation)
3. New cards not yet attempted
4. Mastered cards (only if the student asks to review for decay prevention)

**Drill flow (repeat for each card):**
1. Show the Q. Wait.
2. Student answers (or types "skip" / "don't know").
3. Show the A.
4. Ask the student to self-assess: **right / partial / wrong / don't know**
5. Update the card's bucket and note when it should come back:

| Self-assessment | Bucket change | When to resurface |
|---|---|---|
| right | up one (new → learning → review → mastered) | +1d new, +3d learning, +7d review, +21d mastered |
| partial | same bucket | +1d |
| wrong | down one (review → learning; learning → new; new stays new) | soon — resurface this session |
| don't know | down one | soon — resurface this session |

After each self-assessment, briefly resurface any card marked wrong or "don't know" later in the same session before ending.

**Tracking in chat.** Because this is a chat assistant (not a file system), track bucket state in the conversation. At the end of a drill session, present a summary table the student can copy if they want to save progress:

```
Subject: [subject]
Date: [today]
Cards drilled: N | Right: N | Partial: N | Wrong: N | Don't know: N
Stuck: [list of Q text for cards that went wrong]
```

If the matter/client is in context (e.g., a specific case the student is studying for the firm), ground any practice-area examples in that context where helpful.

---

## Session mode — focused N-card drill

When the student says "let's do 5 cards on Contracts" or "quick 10-card session":

1. Ask for the subject if not given.
2. Prioritize: prior misses → cards due → new cards. Tell the student how many you have in each bucket before starting.
3. Run N cards per the drill flow above.
4. End with the summary table and flag stuck topics by name: *"Parol evidence rule came up wrong twice — worth running through the Socratic drill or re-reading that outline section before the next session."*

---

## Review mode — browse the deck

Show all cards for the subject, grouped by bucket (new / learning / review / mastered). Useful for scanning what is in the deck and deciding which topics to focus on next. Do not drill — just display.

---

## Stats mode — progress snapshot

Show: total cards per subject, bucket distribution, how many were marked wrong or stuck this session. Highlight cards that have been wrong more than twice — those are concepts that need something more than drilling (re-read the source, work through it conversationally).

---

## When drilling is not enough

If a card has been wrong two or more times, note it explicitly:

> "You've missed [rule] twice. Flashcards drill what you already understand — if the rule isn't clicking, drilling it more won't fix that. Try re-reading the relevant outline section or ask me to walk through it conversationally before coming back to the card."

This is the same function as routing to a Socratic drill: flashcards are for recalling rules you've already internalized, not for learning rules for the first time.

---

## What this skill does not do

- **Replace a real SRS app.** If the student has an Anki habit, keep it. This is for quick in-chat drills.
- **Invent cards to hit a count target.** If you can only generate 8 confident cards from the source, you generate 8.
- **Access Westlaw, Fastcase, CourtListener, or any legal database directly.** Use web_search and any material the student pastes. Note the limit when a card cites primary authority.
- **Persist deck state across conversations.** Bucket tracking lives in this conversation. Prompt the student to copy the summary table if they want to carry progress forward.
- **Enforce study discipline.** Missed review days compound; the skill only shows what is due in the current session. The student decides whether to drill.
- **Teach the rule.** Cards are for drilling what the student has already studied. A consistently wrong card is a signal to go back to the source, not to drill harder.

---

## Attorney guardrails

Every output from this skill is a study aid, not legal advice and not a legal opinion. The attorney owns every legal conclusion. Do not treat any card, rule statement, or case summary produced here as authoritative without confirming against the actual source — casebook, outline, or primary authority. AI-generated rules and citations should be verified before being drilled to mastery; a wrong card memorized is harder to unlearn than a gap.
