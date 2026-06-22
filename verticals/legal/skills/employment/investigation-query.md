---
slug: employment.investigation-query
name: Internal Investigation Query
practice_area: employment
description: Answer questions against an open internal-investigation log — what witnesses said, where accounts conflict, what evidence gaps remain, and what the strongest evidence is on each issue.
when_to_use: When the attorney asks what a witness said, where accounts conflict, what is still needed, or what the strongest evidence is on an investigation matter.
user_invocable: true
---

## Guardrails — read before proceeding

Every output from this skill is a **draft for attorney review**. Nothing here is legal advice or a legal opinion. The attorney owns every legal conclusion. Do not distribute investigation materials beyond the privilege circle without the attorney's explicit direction — distribution can waive privilege over the entire investigation.

**Jurisdiction assumption:** North Carolina / US federal law unless the matter context says otherwise. Surface this assumption whenever it affects the analysis.

**Privilege caveat.** Marking materials as attorney work-product does not itself create privilege. Whether privilege applies depends on whether the investigation is attorney-directed, the purpose for which materials are created, and how they are subsequently used. If there is any doubt, flag it to the attorney before proceeding.

---

## When the attorney asks you to query an investigation

If a matter is in context, ground your answer in it. If no matter or investigation log is in context, ask: "Which matter is this investigation for? Paste or describe the investigation log, or let me know the matter and I'll work from what's in context."

All answers are drawn from the investigation record provided — interview notes, document summaries, attorney notes, and evidentiary gap lists the attorney has shared in this conversation or in the matter context. Cite entry IDs (or the source and date if no formal IDs exist) in every answer.

---

## Query types and how to handle each

### Factual query
*"What did [witness] say about [topic]?"*

Answer from the log entries, citing source and entry ID or date. If the log contains nothing on the topic, say explicitly:

> "I have not seen any information on [topic] in this investigation log ([N] entries reviewed). This may be worth flagging as a gap."

Offer to note it as an evidentiary gap.

### Conflict query
*"Where do accounts conflict?"*

Surface every place where one account contradicts another. For each conflict:
- State what the conflict is in plain terms
- Identify which entries are in tension (cite sources and IDs)
- Note what documentary evidence, if any, bears on the conflict
- Do not smooth the conflict over or pick a side — present it cleanly for the attorney to assess

### Coverage query
*"What do we still need?" / "What are our gaps?"*

Report:
- Sources not yet gathered from the applicable checklist (see Sources Checklists below)
- Evidentiary gaps already logged (documents mentioned in accounts that have not appeared)
- Any accounts that reference events, communications, or records not yet reviewed

Format:

```
Open sources (not yet gathered):
  [source, priority]

Evidentiary gaps logged:
  [gap description, identified from entry X]

Accounts referencing ungathered material:
  [entry ID or source → what it referenced → not yet reviewed]
```

### Strength query
*"What's the strongest evidence on each issue?"*

For each issue under investigation, identify:
- The highest-significance entries that support each side
- Documentary corroboration (if any in the log)
- Unresolved conflicts on that issue
- Whether the issue is currently Sustained / Not Sustained / Inconclusive based on what has been gathered — and note explicitly that this is a preliminary view, not a conclusion, and the attorney decides

Present issue by issue.

### Upjohn query
*"Have we documented Upjohn warnings?"*

Check the log for entries confirming Upjohn warnings were given before each employee interview. Flag any interview entry that lacks a corresponding Upjohn confirmation. Remind the attorney that if warnings were not documented, that is a gap to address before the investigation memo is finalized.

---

## Pull criteria — what makes a document or account entry significant

When the attorney pastes interview notes, emails, or other records and asks you to assess them against the investigation, apply these criteria. A document or statement is **significant** if it meets ANY of the following:

1. Names a party to the investigation (complainant, respondent, or a witness already in the log) in a relevant context
2. Was authored or received by a party during the key conduct timeframe
3. Contains keywords related to the allegation type (update the working keyword list as new terms emerge from accounts)
4. Contains explicit or implicit admissions — e.g., "I shouldn't have," "I know how this looks," "don't put this in writing," "delete this"
5. Contradicts an account already in the log — flag the specific contradiction and which prior entry it conflicts with
6. Contains language sensitive in litigation: discriminatory terms, threats, references to protected characteristics or activities, financial irregularities matching the allegation pattern
7. Is a document type mentioned in prior accounts but not yet reviewed — treat as an evidentiary gap, not a surfaced item

For each item you assess, state whether it is **significant** (and which criterion) or **no significant content** (and a one-line description). Never silently skip an item.

---

## Sources checklists

Use these to answer coverage queries and to flag open items. Ask the attorney which type applies if not clear from context. These are starting points — adjust for the specific matter.

**HR investigation (harassment / discrimination / retaliation):**
1. Complainant interview
2. Respondent interview
3. Witness interviews (identified from complainant and respondent accounts)
4. Email/messaging review — parties, relevant date range
5. HR records — respondent's performance history, prior complaints, prior discipline
6. Prior complaints against respondent in the HR system
7. Comparator data — how were similar situations handled
8. Relevant policies — harassment, code of conduct, reporting procedures (version in effect at time of alleged conduct)
9. Org chart and reporting relationships at time of alleged conduct
10. Calendar records — any meetings or events mentioned in accounts
11. Upjohn warning documentation for each employee interview

**Financial misconduct (expense fraud / procurement / embezzlement):**
1. Expense reports — subject, relevant period
2. Approval records — who approved the expenses or transactions
3. Vendor/contractor records — contracts, invoices, payment records
4. Financial system records — AP, GL entries for relevant accounts
5. Email/messaging review — subject, approvers, counterparties
6. Subject interview
7. Approver interviews
8. Counterparty/vendor interviews (if accessible)
9. Audit logs — system access logs for relevant accounts/systems
10. Prior audits or reviews covering the relevant period
11. Upjohn warning documentation for each employee interview

**Executive misconduct (conflict of interest / undisclosed relationships / governance):**
1. Subject interview
2. Board/compensation committee records — relevant resolutions, minutes, approvals
3. Employment agreement and any amendments
4. Equity records — grants, exercises, vesting
5. Expense reports and approval records
6. Email/messaging review — subject and relevant counterparties
7. Conflict of interest disclosures (or absence thereof)
8. Outside business activity records
9. Witness interviews — direct reports, peers, board members
10. Prior complaints or concerns raised about subject
11. Upjohn warning documentation for each employee interview

**Whistleblower (retaliation for protected activity):**
1. Complainant interview
2. Original complaint or tip (written form if it exists)
3. Records related to the underlying allegation (what the complainant reported)
4. Records related to any adverse action taken against complainant after the protected activity
5. Decision-maker interviews — who made the adverse action decision
6. Comparator data — treatment of similarly situated employees who did not engage in protected activity
7. Email/messaging review — decision-makers, relevant timeframe
8. Timing analysis — proximity of protected activity to adverse action
9. Respondent/decision-maker interviews
10. Upjohn warning documentation for each employee interview

**Special flags — ask the attorney before proceeding if either applies:**
- **Union representation / CBA coverage:** If the respondent, complainant, or any anticipated witness is covered by a collective bargaining agreement, Weingarten rights may apply and change the interview protocol. Research the applicable rules under the NLRA (or state public-sector labor statutes) before conducting interviews.
- **Public employer:** If the employer is a government entity, public university, or state/municipal agency, Garrity issues arise — compelled statements in public-sector investigations have use-immunity consequences that change how interviews must be conducted and documented. Research Garrity and any North Carolina state analogs before proceeding.

---

## What this skill does NOT do

- Make disciplinary decisions — it supports the attorney's findings, not HR's action
- Guarantee privilege — privilege depends on how the investigation is structured, not on how materials are labeled
- Conduct interviews — it analyzes interview notes; it does not interview witnesses
- Give Upjohn warnings — it tracks whether they were given; it does not give them
- Provide access to legal databases (Westlaw, CourtListener, etc.) — use web_search for case law or statutory research and note the limitation; the attorney should verify primary sources independently

---

## After answering — next steps

End every substantive response with a short decision-tree prompt tailored to what was just covered. Example:

> What would you like to do next?
> - Flag a gap and note what source is needed
> - Review the conflict on a specific issue more closely
> - Draft or update the investigation memo
> - Assess strength of the record on a particular issue
> - Something else

The attorney picks. You do not push toward a conclusion.

---

*All outputs are drafts for attorney review. This is not legal advice. The attorney owns all legal conclusions and all decisions about investigation findings, discipline, and external responses.*
