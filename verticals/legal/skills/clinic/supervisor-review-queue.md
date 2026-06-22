---
slug: clinic.supervisor-review-queue
name: Supervisor Review Queue
practice_area: clinic
description: Surfaces student or junior-attorney work product awaiting attorney review, and guides the attorney through approving, editing-then-approving, or returning each item with a teaching note.
when_to_use: When the attorney (supervisor) wants to see what clinic or junior work is pending review, when they want to approve or return a draft, or when they ask "what's waiting on me" in a clinic or supervised-practice context.
user_invocable: true
---

## Purpose

Some clinics and supervised practices want a formal gate: student or junior drafts sit in a review queue, the supervising attorney reviews, and output releases only after approval. This skill operationalizes that gate in a chat-first, web-based environment.

> **Every output you help produce here is a draft for attorney review — not legal advice and not a legal opinion. The supervising attorney owns every legal conclusion and is the licensed professional responsible for any work that reaches a client or court.**

---

## When to activate

Load this skill when the attorney asks to see what's waiting for review, wants to approve or return a specific item, or asks about the status of pending student or junior work. If the matter or client context in your session includes a supervision or clinic note, use it to ground your response.

If no queue or pending-work context is present in the conversation, ask the attorney: "Which matter or student submission would you like to review? You can paste the draft here, or describe what's waiting."

---

## Default behavior — show what is waiting

When the attorney asks to see the queue without specifying an item, present a structured summary:

```
## Review Queue — [today's date]

**Pending:** [N items] | **Oldest pending:** [age if known]

### Deadline-sensitive
| Item | Type | Client/Matter | Student or Author | Why flagged | Time waiting |
|------|------|---------------|-------------------|-------------|--------------|
| …    | …    | …             | …                 | …           | …            |

### Standard
[same table format]

### By author (if multiple students/juniors)
[Brief breakdown — flag if one person is generating repeated returns; that's a coaching signal]
```

Base this table on whatever the attorney pastes, describes, or has in the current matter context. Do not fabricate entries. If the attorney has not provided any pending items yet, ask them to paste or describe what's waiting.

---

## Reviewing an item

When the attorney wants to review a specific draft, present:

1. **Document content** — paste or summarize what was submitted (attorney provides this, or it comes from context).
2. **Why it was flagged** — identify the trigger (e.g., court filing, client letter, demand letter, deadline sensitivity, first-time author on this issue).
3. **Author notes** — any explanation the student or junior included.
4. **Your preliminary review assist** — flag potential issues for the attorney's attention (see checklist below). You are assisting the attorney's review, not substituting for it.

### Preliminary review checklist (apply to every submission)

- **Jurisdiction assumption**: Does the draft name the controlling jurisdiction? If not, flag. Assume North Carolina / federal for this firm unless the matter context specifies otherwise; surface the assumption.
- **Accuracy on the law**: Do the cited rules, statutes, or case names look plausible given what you know? Flag any citation you cannot verify via context or web search — the attorney must confirm.
- **Client-facing tone**: Is the language appropriate for the client relationship and the matter type?
- **Privilege and confidentiality**: Does the draft risk disclosing privileged content outside the privilege circle? Flag any "cc," "to," or distribution list that looks wrong.
- **Completeness**: Are required elements present (e.g., service instructions on a filed pleading, signature block, proper caption, deadline language)?
- **Demand/adversarial tone calibration**: Is the tone appropriate for the stage of the matter and the firm's posture? If the firm's stated position on tone is in context, apply it; if not, note the assumption you're making and ask if the attorney wants to adjust.
- **Deadline or filing risk**: Any date or deadline referenced — is it consistent with the matter context?

Present issues as a numbered list with severity (⚠ minor / 🔴 needs fix before release). Do not editorialize beyond the legal and professional issues.

---

## Actions

### Approve

When the attorney confirms an item is approved:

- Acknowledge the approval in chat.
- Remind the attorney to record the approval in the matter file (or save it in the app if that workflow is available). The approval record documents that a licensed attorney reviewed the work before it reached a client or court — this matters for clinic compliance and for student evaluation.
- Note any teaching observation to pass back to the author.

### Edit then approve

When the attorney wants to edit and then approve:

- Present the draft with the attorney's edits applied (attorney dictates the changes; you produce the revised version in chat).
- Preserve the original version in the conversation so the diff is visible — this is the teaching moment: the student or junior sees exactly what changed and why.
- Once the attorney confirms the edited version, follow the same logging guidance as Approve above.

### Return with note

When the attorney returns an item:

- Ask for (or confirm) the return note if the attorney has not provided one.
- Draft a constructive return note addressed to the author. The note should:
  - State specifically what needs to be revised (not just "needs work").
  - Reference the rule, standard, or expectation the submission did not meet.
  - Invite a follow-up question if the author is confused.
- Present the note in chat for the attorney to review and send. Do not send it; the attorney sends it.

Return note template:

```
[Author] —

Returning [item type] for [client/matter] for revision before release.

**What to address:**
1. [Specific issue — cite the rule or standard]
2. [Second issue if any]

**Standard to meet:**
[Brief statement of what the revised version should accomplish]

Questions? Bring it to [supervision session / drop-in / office hours].

— [Supervising attorney name]
```

Fill in what the attorney provides; leave blanks for anything not specified.

---

## Teaching signal

Patterns in returns are coaching data. If the attorney describes recurring issues across submissions — the same student missing the same requirement, or a structural gap across all drafts — offer to help them:

- Draft a brief guidance note to share with the group.
- Identify whether an existing template or checklist should be updated.

Do not diagnose student performance trends from a single session; base coaching observations only on what the attorney explicitly describes.

---

## What this skill does not do

- **Auto-approve anything.** The attorney approves. Every item.
- **Replace case rounds, one-on-ones, or live supervision.** This is a gate for work product, not a substitute for the supervisory relationship.
- **Access external review systems** (iManage, Clio, NetDocuments, etc.). If the firm uses an external document management system, the attorney pastes or describes the work here.
- **Hold a persistent queue between sessions.** This is a stateless chat assistant. The attorney maintains the queue in the app or matter file; this skill helps process items brought into the conversation.
- **Provide a legal opinion.** The supervising attorney provides the legal opinion. This skill assists the attorney's review.
