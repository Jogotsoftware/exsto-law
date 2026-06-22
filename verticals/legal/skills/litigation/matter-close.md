---
slug: litigation.matter-close
name: Matter Close
practice_area: litigation
description: Guide the attorney through closing a matter by capturing resolution type, final exposure, lessons learned, and archiving the outcome in the substrate.
when_to_use: The attorney says a matter is done, resolved, settled, dismissed, or withdrawn, or asks to close, archive, or record the outcome of a matter.
user_invocable: true
---

# Matter Close

## Purpose

Matters end. The outcome is the single most valuable data point a litigation portfolio generates — it calibrates the risk framework for future matters. Closing a matter captures the outcome structurally so the record stays useful, not just archived.

Every output from this skill is a draft for attorney review, not legal advice and not a legal opinion. **The attorney owns every legal conclusion.** If you are uncertain about jurisdiction-specific closure requirements (e.g., whether a stipulation of dismissal must be filed, whether a legal hold release requires separate steps), surface the question rather than guess.

---

## Jurisdiction assumption

Default to **North Carolina / US federal rules** where jurisdiction matters and none is specified. Surface that assumption explicitly in your output so the attorney can correct it.

---

## Step 1 — Identify the matter

If a matter is already in context (injected by the app), confirm its name and current status with the attorney before proceeding. If no matter is in context, ask: *"Which matter are you closing?"*

Do not proceed until you know which matter this is for.

---

## Step 2 — Collect closing information

Ask the attorney for the following. You may ask all at once or in a short conversational exchange — prefer one clear prompt that lists what you need:

### Resolution type (required)

- **Settled** — with counterparty; dollar amount and material structural terms
- **Dismissed with prejudice** — by what mechanism (motion, stipulation, court order)
- **Dismissed without prejudice** — same; note whether re-filing is still possible
- **Judgment for client** — at what stage; appeal exposure still open?
- **Judgment against client** — at what stage; appeal status; final exposure crystallized
- **Withdrawn** — by which party and circumstances
- **Consolidated** — merged into another matter; identify the parent matter
- **Other** — with explanation

### Resolution date (required)

The date the matter actually ended — settlement agreement executed, order issued, dismissal filed — not the date of this conversation.

### Final exposure (required)

- Actual cost (settlement amount + fees + injunctive or structural cost, as applicable)
- How that compares to the initial exposure range assessed at intake (did the early read prove accurate?)
- If reserves were tracked: booked amount vs. actual

### Lessons (recommended — do not invent if skipped)

Two or three honest sentences: What did the firm get right? What was misjudged? What should intake have flagged earlier? If the attorney skips this, leave it blank — do not fabricate a retrospective.

### Related documents (optional)

Settlement agreement, final order, dismissal — the attorney may note the document name/location or paste excerpts. Not required to close, but useful for the record.

---

## Step 3 — Legal hold check

Before presenting the close summary, ask: *"Is there an active legal hold on this matter? If so, releasing it is a separate step — the matter close does not automatically release any hold."*

Note: legal hold release has its own procedural requirements (notification to custodians, documentation). If the attorney is unsure, flag that they should confirm with any HR or IT stakeholders who received the original hold notice before releasing.

---

## Step 4 — Present the close summary for review

Before recording anything, show the attorney a complete close summary in this format and ask for explicit confirmation:

```
MATTER CLOSE SUMMARY — [Matter Name / ID]
Attorney review required before this is recorded.

Resolution type:    [e.g., Settled]
Resolution date:    [YYYY-MM-DD]
Final cost/exposure:[amount + structural terms]
vs. intake estimate:[comparison — accurate / underestimated / overestimated by ~X%]

Lessons:
[Attorney's words, verbatim or lightly edited for clarity]

Related document:   [name/location, or "not provided"]

Jurisdiction assumption: [e.g., "North Carolina / USDC EDNC rules applied"]

---
Ready to record this outcome? Reply "yes" to confirm.
```

Do not mark the matter closed or record the outcome until the attorney explicitly confirms.

---

## Step 5 — Record the outcome

Once the attorney confirms:

1. If the app provides a way to update the matter's status to **closed**, present the data fields above and instruct the attorney to save them through the app interface (or confirm if the app records it automatically).
2. Present the following **history entry** in chat for the attorney to copy into the matter record or save through the app:

```
[YYYY-MM-DD] — Matter closed: [resolution-type]

Resolution: [narrative — what happened, on what terms]
Final cost: [amount + structural terms if any]
vs. initial exposure: [comparison to intake range]

Lessons:
[2-3 sentences — honest retrospective]

Related document: [settlement agreement / final order / etc., or "none provided"]
```

3. Present the following **closing summary block** for the matter file or notes section:

```
Closed [YYYY-MM-DD]

[Resolution summary in one paragraph. The full retrospective is in the history entry above.]
```

---

## What this skill does not do

- **Re-open matters.** If a closed matter revives (appeal filed, related litigation emerges), open a new matter that references the closed one.
- **Invent lessons.** If the attorney does not provide a retrospective, leave that section empty.
- **Release legal holds.** A matter close is not a legal hold release. Treat them as separate steps.
- **Delete the matter record.** Closed matters remain in the substrate — they are the calibration set for future risk assessments.
- **Substitute for attorney judgment on finality.** Whether a dismissal is truly final, whether appeal windows have run, whether a settlement bars related claims — these are legal conclusions. Surface them as questions, not answers.

---

## Privilege reminder

Do not help paste or transmit privileged settlement communications, attorney-client communications, or work product outside the privilege circle. If the attorney asks you to summarize or share matter details in a context where the recipient is outside the privilege circle (opposing counsel, a third party, a public-facing document), flag the destination and ask the attorney to confirm it is appropriate before proceeding.
