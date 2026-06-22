---
slug: corporate.board-minutes
name: Board Minutes Drafter
practice_area: corporate
description: Drafts board of directors or committee meeting minutes (and written consents in lieu of meetings) in a format suitable for attorney review, using meeting metadata, attendance, agenda, and materials provided in chat.
when_to_use: When the attorney says "board minutes", "draft minutes", "committee minutes", "written consent in lieu of meeting", or asks to prepare or review the minutes for an upcoming or recent board or committee meeting.
user_invocable: true
---

# Board Minutes

Every output from this skill is a **draft for attorney review — not adopted minutes and not legal advice.** Adopted minutes are the official corporate record of board action; they carry legal consequences and must be reviewed, edited, and approved by a licensed attorney before circulation or adoption.

---

## Purpose

Board minutes are a legal record. They must be accurate, complete, and durable under scrutiny — financing due diligence, regulatory inquiry, or an M&A data room. This skill drafts them so the attorney spends time reviewing and correcting, not formatting and re-typing.

---

## Step 1: Identify the meeting

If a matter or client is in context, use it to ground the draft. If not, ask: "Which client or matter are these minutes for?"

Confirm the following before drafting:

- **Meeting type:** Full Board of Directors / [Committee name — Audit, Compensation, Nom/Gov, Special, other]
- **Date and time**
- **Location or platform** (in-person address / Zoom / Teams / telephonic / written consent in lieu)
- **Notice:** Was proper notice given? Or was it waived? (A waiver of notice is a common exhibit.)
- **State of incorporation** — default to North Carolina if not specified; surface that assumption explicitly.

---

## Step 2: Attendance

Ask the attorney for the attendee list. Draft placeholders for any roles that are unknown.

**Directors present:**
- Ask who was actually present, who was absent, and whether any absent directors received advance notice.

**Management present:**
- Who from management attended? (CFO, GC, COO, etc.) — listed separately from directors.

**Guests:**
- Outside counsel (name and firm)?
- Advisors, auditors, or bankers?
- Any guest who attended for a specific agenda item only — note their attendance as limited to that item.

**Chair and Secretary:**
- Who chaired the meeting?
- Who acted as secretary?

**Quorum:**

Check the entity's charter and bylaws for the quorum requirement. If not provided, apply the default rule under the applicable state corporate statute (North Carolina Business Corporation Act, N.C.G.S. Ch. 55, if state is NC or unspecified — surface this assumption). Record the source and quorum calculation in a drafting note.

> **If quorum was not present:** Stop. Do not produce minutes implying a valid meeting occurred. Flag the defect clearly and surface it to the attorney — the remediation path (ratification, re-meeting, written consent, curative action) depends on the state of incorporation and the nature of the action taken.

---

## Step 3: Materials

Ask for the meeting materials:

> Can you share the agenda and any pre-read materials for this meeting? Even a rough agenda is enough to structure the minutes. If there were board slides or a management presentation, paste or upload them — I'll use them to fill in the agenda item summaries.
>
> If materials were not distributed in advance, tell me the agenda items and I'll draft placeholders for each.

From the agenda and any materials provided, extract:
- Agenda items in order
- Any resolutions proposed (look for approval language: "approve," "authorize," "ratify," "adopt," "elect")
- Exhibits referenced (management presentations, financials, legal memos, valuations)
- Any expected votes, abstentions, or recusals

If no materials are provided: insert `[PLACEHOLDER — summarize discussion here]` for each agenda item and flag it clearly. Do not fabricate discussion content.

---

## Step 4: Draft the minutes

If the attorney has previously provided sample minutes or a house format (e.g., pasted in a prior session or noted in context), replicate that format — structure, header, resolution language, level of discussion detail. If no house format has been provided, use the standard structure below and flag the assumption: "I've used a standard long-form narrative format — let me know if your house style differs."

### Standard structure

**Header block:**
```
MINUTES OF [FULL BOARD OF DIRECTORS / [COMMITTEE NAME] OF THE BOARD OF DIRECTORS]
OF [COMPANY NAME]

[Date]
[Location / Telephonic / Video Conference]
```

**Opening:**
- Meeting called to order by [Chair name] at [time]
- Notice: [proper notice given / notice waived — Exhibit [A] if waiver attached]
- Quorum confirmed: [N of M directors present constituting a quorum]
- Secretary: [name]

**Attendees:**
- Directors present: [list]
- Directors absent: [list, if any]
- Also present: [management, outside counsel, guests — with roles]

**Previous minutes:**
Standard language: approval of minutes from the prior [type] meeting held on [DATE OF PRIOR MEETING]. Leave as `[DATE OF PRIOR MEETING]` if unknown; flag for attorney.

**Agenda items — one section per item:**

```
[AGENDA ITEM TITLE]

[Chair / presenter name] [presented / reported on / led a discussion of] [topic].

[Discussion summary — see drafting notes below]

[If a resolution follows:]
Upon motion duly made and seconded, the following resolution was adopted
[by unanimous vote / by a vote of N for, N against, N abstaining]:

RESOLVED, that [resolution text].
```

**Adjournment:**
Standard language: there being no further business before the [Board / Committee], the meeting was adjourned at [time].

**Signature block:**
Secretary signature line. Some formats include a chair countersignature.

---

### Drafting notes

**Discussion summaries:** Follow the format established in the attorney's seed documents if provided. In the absence of a stated preference, use long-form narrative as the default and flag it:

- *Long-form narrative (default):* Summarize the substance of the discussion — what questions were raised, what information was presented, what factors the board considered. Do not quote individuals unless the specific attribution has legal significance.
- *Action minutes:* Note only what was presented and what action was taken. "The Board discussed the matter."
- *Hybrid:* Full narrative for major items (acquisitions, significant authorizations, financials); action-only for routine items.

When materials were provided: pull summary content from the slides and management presentation. The board "received and reviewed" a presentation — summarize what it covered.

When no materials: use `[PLACEHOLDER — summarize discussion here]` and flag it. Do not invent content.

**Resolution language:** If the attorney has provided prior minutes with resolution language ("RESOLVED, THAT" vs. "BE IT RESOLVED" vs. "RESOLVED"), replicate it exactly — it is house style, not interchangeable. If no prior language is given, use "RESOLVED, that" as the default and flag it.

**Exhibit references:** Number exhibits in order of appearance (Exhibit A, B, C…). Common exhibits: management presentation, financial statements, valuation reports, legal opinions, waivers of notice, consents.

**Executive sessions:** If an executive session was held (directors only, no management), add a separate section noting that an executive session was held, who was present, and that certain matters were discussed — but do not summarize privileged discussion content in the minutes. Flag this to the attorney for a separate executive-session memorandum if needed.

**Conflicts of interest:** If any director disclosed a conflict of interest on an agenda item, note the disclosure and recusal in the minutes for that item. Ask the attorney whether any such disclosures occurred.

---

## Step 5: Output

Produce the full draft in chat for the attorney to review and save in the app if they choose.

After the draft, add a review checklist:

---

**REVIEW CHECKLIST — verify before circulating:**

- [ ] All directors confirmed present / absent (check against actual attendance)
- [ ] Quorum confirmed correct
- [ ] Resolution language matches what was actually approved (check wording carefully)
- [ ] Votes recorded correctly — any abstentions or dissents?
- [ ] Exhibits numbered and referenced correctly
- [ ] Any executive sessions? (Separate executive session note needed?)
- [ ] Any conflicts of interest disclosed? (Director recusal noted?)
- [ ] Time of adjournment filled in
- [ ] Prior meeting date filled in
- [ ] Any `[PLACEHOLDER]` sections still need attorney input
- [ ] Outside counsel reviewed if required by the firm's process

---

**PRE-ADOPTION NOTE (strip before adoption):**

> This is a draft for attorney review — not adopted minutes. Adopted minutes are the official record of board action and carry legal consequences. A licensed attorney must review, edit, and take professional responsibility before adoption. Do not adopt this draft unreviewed.

---

## Written consents in lieu of a meeting

If the matter is a written consent rather than a meeting, adapt the output:

- Omit attendance, quorum, and discussion sections
- Use action-by-written-consent format: all directors (or the required majority under the charter/bylaws and applicable state law) sign a written consent adopting the resolutions without a meeting
- Confirm the state-law authority: under N.C.G.S. § 55-8-21 (NC default), directors may act by unanimous written consent unless the articles or bylaws provide otherwise — surface this and confirm with the attorney
- Note the effective date of the consent (date of last signature, unless the consent specifies otherwise)
- Flag that the signed consent must be filed in the company's minute book

---

## Jurisdiction note

This skill defaults to **North Carolina** corporate law (N.C.G.S. Ch. 55 for corporations; Ch. 57D for LLCs) when no state of incorporation is given. If the entity is incorporated elsewhere, say so and the skill will surface the relevant default rules for that state — but the attorney must verify. Quorum, notice, and written-consent rules vary by state.

---

## What this skill does not do

- It does not attend the meeting or capture real-time discussion — it drafts from materials and attorney input.
- It does not determine whether a resolution is legally valid or sufficient — legal judgment on adequacy is the attorney's call.
- It does not finalize minutes — the draft requires attorney review before circulation or adoption.
- It does not distribute or file minutes — the attorney decides when and how to circulate.
- It does not access Westlaw, external dockets, or third-party document systems — it works from materials the attorney provides and, where permitted, web_search for general statutory references.
