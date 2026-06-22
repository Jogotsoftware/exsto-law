---
slug: litigation.oc-status
name: Outside Counsel Status Request Drafter
practice_area: litigation
description: Draft weekly status-request emails to outside counsel for one matter or across the active portfolio, grounded in matter context, upcoming deadlines, and open questions.
when_to_use: When the attorney asks to check in with outside counsel, draft a status email to OC, or request updates on matters handled by outside firms.
user_invocable: true
---

# Outside Counsel Status Request Drafter

> **Every draft produced by this skill is for attorney review before sending — not legal advice and not a legal opinion. The attorney owns every decision about what to communicate to outside counsel, including what strategic information to share, what questions to ask, and when to send. Do not send any draft without attorney review. Routine weekly check-ins can inadvertently put theory, strategy, or concessions in writing — review carefully.**

> **Privilege note:** Communications directing or coordinating with retained outside counsel on an active matter are typically attorney-client privileged and/or work product. Do not paste the draft or the underlying matter information outside the engagement circle (i.e., do not share with non-lawyers, adverse parties, or anyone outside the privilege circle) without the attorney's explicit direction.

---

## Purpose

Drafting the same status-request email to outside counsel across multiple active matters is mechanical cognitive work. The content is consistent (status since last update, upcoming deadlines, pending decisions, budget), the audience is consistent (OC lead partner or primary contact), and the tone should match the firm's established outside-counsel-directive style. This skill drafts those emails for attorney review.

---

## Identify scope

**If a specific matter is already in context** (injected by the app), draft for that matter.

**If the attorney specifies a matter by name**, draft for that matter.

**If the attorney asks for the full portfolio** (e.g., "draft status emails for all my OC matters"), draft one email per active matter that has outside counsel assigned. Ask the attorney to confirm the list before drafting if there are more than five matters.

If no matter or scope is clear, ask: "Which matter — or would you like me to draft for all active matters with outside counsel assigned?"

---

## Filtering — which matters get a draft?

When running across the portfolio, apply these defaults:

- Include matters where outside counsel is assigned and the matter is active (not closed/resolved).
- Prioritize matters where no status update has been logged in the last 10 days, OR where a deadline falls within 21 days.
- Skip matters updated in the last 10 days unless the attorney overrides.
- If outside counsel contact information is missing, note the gap rather than skipping silently — flag it to the attorney.

The attorney may override any filter: "draft for all of them," "just [matter name]," or "skip [matter name]."

---

## Context to ground each draft

Use whatever is available in the current session context. In priority order:

1. **Matter context injected by the app** — matter name, current posture, assigned outside counsel (firm, lead contact, contact info), next deadline, open questions, budget authorization, last update date.
2. **Documents or notes the attorney pastes in** — recent correspondence, prior status emails, internal notes.
3. **Attorney answers to clarifying questions** — if key information is missing (e.g., no outside counsel contact on record, no deadline information), ask one short question per gap before drafting.

Do not invent matter facts, deadline dates, budget figures, or outside-counsel contact details. If a field is missing, leave it as a placeholder and flag it.

---

## Outside counsel directive style

Apply the firm's stated communication style if provided in context or by the attorney. If no style is specified, use a professional, collegial first-name tone with a short bulleted structure — direct and respectful of the OC partner's time. Surface this assumption and ask the attorney to correct it if wrong.

---

## Per-matter email draft

### Subject line

Default: `[Matter: [Matter Name]] — Weekly Status Request`

If the attorney has a house convention (e.g., matter number prefix, client code), apply it. Surface the assumption.

### Body structure

```
[OC lead first name],

[One-sentence opener — natural, collegial. Examples: "Hope the week is going well." / "Checking in as we head into [month]." Match the firm's stated tone.]

Checking in on [Matter Name]. A few items:

1. **Status update** — What's moved since [date of last update, or "our last conversation" if unknown]? Any filings, hearings, correspondence, or calls we should know about?

2. **Upcoming deadlines** — I show [next deadline from context, or "no hard deadline on my end — please confirm coverage"]. Please confirm your coverage plan and flag any dates we should add to our calendar.

3. **Decisions pending** — [List open questions from matter context that require OC input. If none are noted, ask broadly: "Any outstanding decisions or approvals you're waiting on from our side?". Omit this item only if there are clearly none.]

4. **Budget check** — [Frequency: monthly / quarterly / as needed — ask the attorney if not specified.] Where do we stand against [budget authorization from context, or "the authorized budget"]? Any variance to flag?

[Optional 5. If a specific deliverable is pending — e.g., "Please send me the latest draft of [document] before [date]" — include only if there is a concrete pending item in context. Otherwise omit.]

[Attorney's name, title, firm, contact info — ask the attorney to confirm their preferred sign-off for OC communications if not already established.]
```

Adapt the structure to match the attorney's stated style. If they prefer a single-paragraph check-in, honor that. If they want a more formal "Dear [Full Name]" opening, honor that.

---

## Output

Present each draft in chat for attorney review. Format it clearly as a draft:

```
---
DRAFT — FOR ATTORNEY REVIEW BEFORE SENDING
Matter: [Matter Name]
To: [OC lead name], [OC firm] ([email if known; otherwise flag as missing])
Subject: [subject line]
---

[body]

---
⚑ REVIEW BEFORE SENDING: Check for (1) privileged content you did not intend to share beyond the engagement, (2) factual accuracy of deadlines and budget figures, (3) tone and completeness, (4) any strategic information this email puts in writing that you want to reconsider. Do not send unreviewed.
---
```

If multiple matters are in scope, present them sequentially with a brief summary at the end listing what was drafted, what was skipped, and any gaps flagged (missing OC contact, missing deadline, etc.).

If the attorney wants to save a draft or send it, they can copy the body from chat or use the app's document/draft tools to store it against the matter.

---

## Gaps and assumptions — flag explicitly

For every assumption or missing piece, state it clearly:

- "I assumed a monthly budget-check cadence — correct this if your practice is quarterly or on-request."
- "No outside counsel email is in context for [matter] — you will need to add the To: address before sending."
- "No deadline is on record for [matter] — the email asks OC to confirm; add a specific date if you have one."
- "I used a collegial first-name tone — let me know if your outside-counsel directive calls for a more formal style."

---

## What this skill does not do

- **Send emails.** Drafts only. The attorney reviews and sends.
- **Access Gmail or email systems directly.** If you want to create a Gmail draft, copy the body and paste it into Gmail. This chatbot does not have email-send capability.
- **Generate content it does not have.** If matter context is thin, the email is short and asks broad-status questions. It does not invent specific facts, deadlines, or strategic questions.
- **Access Westlaw, CourtListener, or docket systems.** It cannot pull filing history or docket entries. If docket information is relevant, use web_search or provide the attorney-retrieved records in context.
- **Update the matter record.** After OC responds, the attorney should log the update in the app against the matter. This skill does not write back to the substrate.
- **Override attorney judgment.** If the attorney decides to change the tone, omit a section, or add information not in context, follow their direction. The attorney controls what goes to outside counsel.

---

## Jurisdiction note

Default jurisdiction: North Carolina / US federal courts where relevant. Most outside-counsel status emails are jurisdiction-neutral, but if a deadline or procedural question arises that is jurisdiction-specific, surface the assumption and apply NC rules unless the matter context specifies otherwise.
