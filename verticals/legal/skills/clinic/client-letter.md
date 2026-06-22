---
slug: clinic.client-letter
name: Client Letter (Routine Correspondence)
practice_area: clinic
description: Draft routine client correspondence — appointment confirmations, document request letters, and brief status updates — using plain-language templates with required sign-off elements and a pre-send review checklist.
when_to_use: When the attorney needs to send a client an appointment confirmation, a request for documents, or a brief "we filed it / we're waiting" status note, and wants a reviewed template draft rather than starting from scratch.
user_invocable: true
---

# Client Letter: Routine Correspondence

## Purpose

Handle the routine outbound letters that go to clients on a regular basis — appointment confirmations, document requests, brief status updates. Use templates so these don't have to be written from scratch every time.

**Scope: routine only.** If the letter would convey substantive advice, bad news, strategy, a case-closing determination, or an adverse ruling, that is not a routine letter — discuss the substance with the attorney first, then draft.

> **Every output from this skill is a draft for the attorney's review — it is not legal advice and does not constitute a legal opinion. The attorney owns every letter that leaves this firm.**

---

## Working with Matter Context

If a matter and client are already in context (injected by the app), use that information to ground the draft — pull the client name, relevant deadlines, and any known facts. If no matter is in context, ask: "Which matter or client is this letter for?"

---

## Letter Types

Tell you which type is needed (or ask if unclear):

- **appointment** — confirm an upcoming meeting
- **doc-request** — request documents from the client
- **update** — brief "here's what happened / here's what's next" note

---

## Review Label (Internal Only)

Every draft produced by this skill begins with the following label **for the attorney's eyes, not the client's**. Remove it before sending:

```
[AI-ASSISTED DRAFT — requires attorney review before sending]
```

This label must never appear in the client-facing copy. If it ends up in the letter the client receives, something went wrong.

---

## Template: Appointment Confirmation

*Remove the review label below before sending to client.*

`[AI-ASSISTED DRAFT — requires attorney review before sending]`

```
Dear [Client Name],

This confirms your appointment with Pacheco Law:

Date: [date]
Time: [time]
Where: [address / or "by phone at [phone number]" / or "by video — link to follow"]
With: [attorney or staff name]

Please bring: [list documents needed — pull from matter context or prompt the attorney to fill in]

If you need to reschedule, call us at [firm phone] at least 24 hours before.

[Attorney/Staff Name]
Pacheco Law
[phone] | [email]
```

**Fill-in notes:**
- "Please bring" — pull from matter context if available; otherwise leave as a bracketed prompt for the attorney to complete.
- If the appointment is remote, include the link or dial-in number.

---

## Template: Document Request

*Remove the review label below before sending to client.*

`[AI-ASSISTED DRAFT — requires attorney review before sending]`

```
Dear [Client Name],

To move your case forward, we need the following documents from you:

- [Document 1 — e.g., "Your signed lease agreement"]
- [Document 2 — e.g., "The notice you received from the other party"]
- [Document 3]

How to get them to us: [drop off at our office / email to [address] / bring to your next appointment]

Please send by: [date — if there's a deadline, explain why: "We need these by [date] so we can file your response before the court deadline."]

If you don't have some of these documents or aren't sure what we're asking for, call us at [firm phone] and we'll help.

[Attorney/Staff Name]
Pacheco Law
[phone] | [email]
```

**Fill-in notes:**
- Be specific about each document — generic requests create confusion and delay.
- If there's a hard deadline, always explain the reason. Clients respond faster when they understand why.
- Spell out any legal term the client may not know: "your 'answer' — that's the document that tells the court your side of the story."

---

## Template: Brief Status Update

For routine "we filed it" or "we're waiting" notes. For a fuller status summary, handle that separately in a conversation.

*Remove the review label below before sending to client.*

`[AI-ASSISTED DRAFT — requires attorney review before sending]`

```
Dear [Client Name],

Quick update on your case:

[One sentence: what happened — e.g., "We filed your answer with the court on [date]" / "We sent the demand letter to [party] on [date]" / "We are reviewing the documents you sent."]

What's next: [One sentence — e.g., "We are waiting for their response" / "The court will schedule a hearing and we will let you know the date" / "We will follow up with you by [date]."]

You don't need to do anything right now. We'll reach out as soon as there's a development that requires your attention.

[Attorney/Staff Name]
Pacheco Law
[phone] | [email]
```

**Fill-in notes:**
- One sentence for "what happened," one sentence for "what's next" — keep it short.
- If the client owes anything (a signature, a document, a payment), this template is not sufficient — use the doc-request template or call them.

---

## Plain-Language Check

Before finalizing any draft, verify:

- Sentences are short. Aim for one idea per sentence.
- No unexplained legal terms. If a legal term appears, explain it in plain words immediately after: `"your 'answer' — the document that tells the court your side."``
- Reading level is accessible. Clients come in with varying literacy levels; err toward simpler.
- The tone is professional and warm — not cold, not overly casual.

North Carolina courts and ethics rules do not mandate a specific reading level for client letters, but plain language is a professional standard and supports RPC 1.4 (the duty to keep clients reasonably informed in a way they can understand).

---

## Pre-Send Checklist

Before the letter goes out, confirm all of the following:

1. The attorney has reviewed and approved the draft.
2. All review labels (`[AI-ASSISTED DRAFT]`) and bracketed placeholders (`[date]`, `[VERIFY]`, etc.) have been removed or filled in.
3. The letter contains nothing substantive — no legal advice, no case strategy, no characterization of legal rights. If it does, stop and discuss with the attorney first.
4. The letter is going to the client (or authorized recipient), not to opposing counsel or a court — those require different handling.
5. If the matter has a known language preference for the client, confirm the letter is in the right language or has been translated.

**Sending a letter to a client is a consequential act — it is a communication on the firm's behalf.** A licensed attorney reviews, edits, and approves before it goes out. Do not present this draft as ready to send; present it as ready for attorney review.

---

## What This Skill Does Not Do

- **Substantive advice or bad news.** If the letter needs to say "here is what I think about your case," "we cannot help you," or "the court ruled against you" — that is not routine correspondence. Draft it only after the attorney has resolved the substantive position.
- **Letters to opposing counsel or courts.** Different audience, different standards, different skill.
- **Case-closing or withdrawal letters.** Those carry specific ethical obligations under RPC 1.16 (North Carolina). Handle those separately and carefully.
- **Demand letters.** A demand letter is a legal communication that asserts rights or positions — not routine.

---

## Jurisdiction and Assumptions

Default jurisdiction is **North Carolina**. Pacheco Law is a North Carolina firm.

North Carolina RPC 1.4 requires keeping clients reasonably informed and promptly responding to requests for information. Regular, clear correspondence satisfies this obligation. If this matter involves another jurisdiction, surface that assumption.

> All outputs are drafts for attorney review. The attorney is responsible for the legal sufficiency of every communication that leaves the firm.
