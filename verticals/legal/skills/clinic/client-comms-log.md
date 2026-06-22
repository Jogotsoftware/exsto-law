---
slug: clinic.client-comms-log
name: Client Communications Log
practice_area: clinic
description: Log, review, summarize, and audit client communications (calls, emails, texts, letters, in-person meetings) for a matter, producing an append-only dated record with direction, medium, summary, and action items.
when_to_use: When the attorney wants to log a client call, email, or other contact; review what was communicated on a matter; summarize communication history; or scan for unanswered messages, missed follow-ups, or contact gaps.
user_invocable: true
---

# Client Communications Log

## Purpose

Four reasons to keep this log:

1. **Malpractice defense.** If a client claims "no one ever told me [X]," a dated entry showing otherwise is the answer. A contemporaneous, accurate record is the defense.
2. **Continuity across time.** When you return to a matter after weeks away — or when another attorney covers — the log answers "what did we tell this client last time" without re-reading every email thread.
3. **Supervision and pattern visibility.** Five unreturned voicemails over six weeks is a pattern. Individual entries may not flag it; the log as a whole does.
4. **File retention obligations.** Complete client files include communication history. The log satisfies that obligation.

Keep entries light. Two to four sentences after every contact is the target.

> **Every output from this skill is a draft for the attorney's review — it is not legal advice and does not constitute a legal opinion. The attorney owns the record and the legal conclusions.**

---

## Modes

When the attorney asks to use this skill, determine which mode applies:

- **Add** — log a new communication entry (default)
- **Read** — show recent entries for a matter
- **Summary** — produce a one-paragraph condensed read of the communication history
- **Patterns** — scan the provided log for concerns (unanswered comms, missed follow-ups, gaps, tone shifts)

If the attorney doesn't specify, default to **Add**.

---

## Working with Matter Context

If a matter and client are already in context (injected by the app), use that information to ground the entry. If no matter is in context, ask: "Which matter or client is this communication for?"

---

## Mode: Add — Log a New Entry

**Gather the following from the attorney (prompt for any that are missing):**

| Field | Notes |
|---|---|
| Date and time | Default to today/now if not given; flag the assumption |
| Direction | `In` (client → firm) or `Out` (firm → client) |
| Medium | Call / Email / Text / Letter / In-person / Video / Voicemail left / Voicemail received |
| Attorney/staff | Who on the firm side |
| Client side | Client name, or "Third party: [description]" if opposing counsel, family member, etc. |
| Duration/length | e.g., "10-min call," "3-paragraph email," "45-min in-person" |
| Summary | 2–4 sentences — what happened, what was substantive |
| Action items — firm | What the firm owes the client, with deadline |
| Action items — client | What the client owes the firm, with expected timing |
| Follow-up due | Date, if applicable |
| Notes | Language used, emotional tone, anything that matters but doesn't fit above |

**Before presenting the final entry**, show it to the attorney and ask for confirmation. Clinic and client-file records should be reviewed before they're written.

**Format each entry as:**

```
---
**[YYYY-MM-DD HH:MM] — [Direction]: [Medium]**
Participants: [firm side] / [client side]
Duration: [duration]

[Summary paragraph — 2–4 sentences]

Action items (firm): [list, each with deadline]
Action items (client): [list, each with expected timing]
Follow-up due: [date or "none"]
Notes: [anything else, or omit if empty]
```

Present the formatted entry in chat for the attorney to review. Remind them to save it to the matter record in the app if they choose.

**Append-only rule:** never edit or delete past entries. If an entry is wrong, write a new entry that references and corrects it. The integrity of the log depends on not rewriting history.

**If a communication establishes a deadline** (e.g., "client said they need to respond by Friday"), flag it: "This communication established a deadline — consider adding it to the matter's deadline tracker."

---

## Mode: Read — Show Recent Entries

Present the most recent entries from the communication log for the matter (default: last 5 entries, or as many as the attorney has provided in context). If no log has been shared, ask the attorney to paste or upload the existing log.

---

## Mode: Summary — Condensed Read

Produce a one-paragraph summary covering:
- Most recent contact (date, direction, medium)
- Total number of entries (if known)
- Most common communication medium
- Any open action items on the firm's side
- Any unanswered communications from the client

This summary is suitable for a handoff memo or a quick status check.

---

## Mode: Patterns — Flag Concerns

Scan the log the attorney provides and flag:

- **Unanswered communications from client.** Client contacted the firm N times without a response entry.
- **Missed follow-ups.** An action item listed a due date, and no later entry confirms it was completed.
- **Language or accommodation issues.** Client's primary language was noted as non-English; check whether outgoing communications were in that language.
- **Escalation patterns.** Tone noted as frustrated or distressed, recurring across entries — flag for attorney attention.
- **Contact gaps.** Long stretches with no entry on an active matter; flag if the gap appears disproportionate to the matter's pace.

Present findings as a brief bulleted list. Flag only what is genuinely present in the provided log — do not speculate about what is not recorded.

This mode is supervision-oriented. It surfaces patterns the attorney may want to act on.

---

## What This Skill Does Not Do

- **Store substantive legal analysis.** Legal strategy, research conclusions, and case theory go in separate matter notes — not in the communications log. The log is a record of contact facts, not legal thinking.
- **Auto-pull from email or phone systems.** If the firm's case management system (e.g., Clio) has an integration, it could supply log data automatically. Without that, the attorney provides or pastes the log here.
- **Edit past entries.** See the append-only rule above.
- **Replace privilege review.** If the attorney needs to record strategic thinking or attorney-client privileged analysis, that belongs in internal matter notes — not the communications log, which may be more broadly discoverable.

---

## Jurisdiction and Assumptions

This skill applies generally across U.S. jurisdictions. Default assumptions are North Carolina when a jurisdiction is relevant (e.g., ethical obligations around communication frequency and file retention). If the matter is in another jurisdiction, surface that assumption and adjust.

North Carolina ethics rules (RPC 1.4) require keeping the client reasonably informed and promptly responding to reasonable requests for information. A well-kept communications log supports compliance with this obligation.

> All outputs are drafts for attorney review. The attorney is responsible for the accuracy of the record, for any legal conclusions, and for any action taken in reliance on this log.
