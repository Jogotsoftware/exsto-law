---
slug: employment.investigation-open
name: Internal Investigation Open
practice_area: employment
description: Opens a new privileged internal investigation — runs intake, generates a type-specific sources checklist, and maintains a structured log that can be turned into a privileged memo at any point.
when_to_use: When a complaint, allegation, audit finding, or tip comes in and the attorney needs to stand up a privileged investigation (harassment, discrimination, retaliation, financial misconduct, executive misconduct, or whistleblower matters).
user_invocable: true
---

# Internal Investigation

> **Every output produced by this skill is a draft for attorney review only — not legal advice, not a legal opinion, and not a final legal conclusion.** The attorney owns every finding, every credibility assessment, and every disciplinary or response recommendation.

> **Distribution discipline.** Everything this skill produces — intake logs, source checklists, memo drafts, audience summaries — inherits the privilege and confidentiality status of the underlying investigation. Distribution beyond the privilege circle (forwarding to non-attorneys outside the investigation team, cc'ing HR without scoping, handing to the business side) can waive privilege over the entire investigation. Every distribution decision must be deliberate.

---

## Privilege notice — read before proceeding

**Marking does not create privilege.** Labeling a document "Attorney Work Product" or "Attorney-Client Privileged" reflects the intended protection but does not itself establish privilege. Whether any given output is actually privileged depends on whether the investigation is attorney-directed, the purpose for which documents are created, and how they are subsequently used or disclosed.

**Before opening a matter, confirm:** Is this investigation attorney-directed? If HR is running it with legal in only an advisory role, or if it was not initiated at the direction of counsel for the purpose of obtaining legal advice, the privilege analysis changes materially and any "privileged" labeling may be misleading. Flag that question to the attorney before creating any log or file.

If there is any doubt about privilege applicability, the attorney should resolve it before investigation files are created. Improperly labeled materials can create problems in discovery if privilege is later challenged.

**Jurisdiction assumption.** Unless the matter specifies otherwise, assume North Carolina law and applicable federal law (Title VII, FLSA, NLRA, and related statutes). Surface that assumption and adjust if the attorney indicates a different jurisdiction.

---

## Step 1 — Intake

If a matter is active in your context, ground the investigation in it. If no matter is in context, ask the attorney which matter or client this belongs to before proceeding.

Ask the following in a single block:

> To open the investigation log I need a few things:
>
> **The matter**
> - What is the allegation or concern in plain terms?
> - Who is the complainant (or what triggered this — complaint, tip, audit, manager observation)?
> - Who is the respondent or subject?
> - What is the approximate timeframe the alleged conduct occurred?
> - Is this attorney-directed? (If yes: work product protection likely applies. If no: flag privilege risk before proceeding.)
>
> **Investigation type** (helps generate the right sources checklist)
> - HR: harassment / discrimination / retaliation
> - Financial misconduct: expense fraud / procurement irregularities / embezzlement
> - Executive misconduct: conflict of interest / undisclosed relationships / governance failures
> - Whistleblower: retaliation for protected activity
> - Other: describe briefly
>
> **Representation and employer status** (surfaces parallel legal frameworks that change interview procedure)
> - Is the respondent, the complainant, or any anticipated witness represented by a union or covered by a collective bargaining agreement? (If yes, flag for Weingarten research — representational rights at investigatory interviews may apply and change the interview protocol.)
> - Is the company a public employer (government entity, public university, state or municipal agency) or otherwise acting under color of state law? (If yes, flag for Garrity research — compelled statements in public-sector investigations have special use-immunity consequences and change how interviews must be conducted and documented.)

If either the Weingarten or Garrity flag fires, research the applicable rules using web_search (NLRA / state public-sector labor statutes for Weingarten; 5th Amendment and the Garrity line of cases, plus North Carolina or relevant state analogs for Garrity) before proceeding to interviews. Cite primary sources. Verify currency. Do not proceed to interview guidance until the attorney has confirmed the adjusted protocol.

---

## Step 2 — Present the investigation log structure

Present the following as a structured summary in chat (not a file — the attorney can save it in the app if they choose):

```
Investigation Log Opened
Matter: [matter name]
Opened: [today's date]
Attorney-directed: [yes/no]
Allegation: [plain-language summary]
Complainant: [name/role or anonymous]
Respondent: [name/role]
Conduct timeframe: [approximate dates]
Investigation type: [HR/financial/executive/whistleblower/other]
Status: Open

Issues identified:
  1. [Issue 1 — derived from allegation, e.g., "alleged hostile work environment"]
  2. [Issue 2 if applicable]

Evidentiary gaps: [none yet — to be updated as sources are gathered]
```

---

## Step 3 — Sources checklist

Generate the appropriate checklist based on investigation type. Present it to the attorney and ask: "Does this fit your matter? Let me know if any items are not applicable or if there are additional sources specific to this situation."

### HR investigation (harassment / discrimination / retaliation)

1. Complainant interview
2. Respondent interview
3. Witness interviews — identify from complainant and respondent accounts
4. Email/messaging review — parties, relevant date range
5. HR records — respondent's performance history, prior complaints, prior discipline
6. Prior complaints — any prior complaints against respondent
7. Comparator data — how were similar situations handled
8. Relevant policies — harassment, code of conduct, reporting procedures (**use the version in effect at the time of alleged conduct**, not the current version)
9. Org chart and reporting relationships at time of alleged conduct
10. Calendar records — any meetings or events mentioned in accounts
11. Upjohn warning documentation — confirm interviews were preceded by Upjohn warnings and documented

### Financial misconduct (expense fraud / procurement / embezzlement)

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
11. Upjohn warning documentation

### Executive misconduct (conflict of interest / governance failures)

1. Subject interview
2. Board/compensation committee records — relevant resolutions, minutes, approvals
3. Employment agreement and any amendments
4. Equity records — grants, exercises, vesting
5. Expense reports and approval records
6. Email/messaging review — subject, relevant counterparties
7. Conflict of interest disclosures (or absence thereof)
8. Outside business activity records
9. Witness interviews — direct reports, peers, board members
10. Prior complaints or concerns raised about subject
11. Upjohn warning documentation

### Whistleblower (retaliation for protected activity)

1. Complainant interview
2. Original complaint or tip — written form if it exists
3. Records related to the underlying allegation (the thing complainant blew the whistle on)
4. Records related to any adverse action taken against complainant after the protected activity
5. Decision-maker interviews — who made the adverse action decision
6. Comparator data — treatment of similarly situated employees who did not engage in protected activity
7. Email/messaging review — decision-makers, relevant timeframe
8. Timing analysis — proximity of protected activity to adverse action
9. Respondent/decision-maker interviews
10. Upjohn warning documentation

After the attorney confirms the checklist, present it as the working source tracker in chat. The attorney can update status ("complete," "in progress," "N/A") as sources are gathered.

---

## Adding data to the log

When the attorney pastes interview notes, document excerpts, or other data, process it as follows.

### Identify the data type

If not clear from context, ask:
- Interview notes (whose interview?)
- Document batch (emails, records, files)
- Attorney notes or observations
- Upjohn warning confirmation

### Document pull criteria

For any document batch, apply the following pull criteria. A document is surfaced if it meets **any** of the following. The criteria are intentionally set to surface slightly aggressively — it is better to surface a false positive than to miss a significant item.

1. Contains the name of any party to the investigation (complainant, respondent, witnesses named in prior log entries)
2. Was authored or received by a party during the key conduct timeframe
3. Contains keywords related to the allegation type (update the keyword list as new terms emerge from accounts)
4. Contains explicit or implicit admissions ("I shouldn't have," "I know how this looks," "don't put this in writing," "delete this")
5. Contains language contradicting any account already in the log — flag the specific contradiction and which prior account it conflicts with
6. Contains language that would be sensitive in litigation: discriminatory terms, threats, discussions of protected characteristics or activities, financial irregularities matching the allegation pattern
7. Is a document type mentioned in prior accounts but not yet produced (e.g., a meeting was mentioned in an interview but no calendar invite has been reviewed) → flag as an evidentiary gap

**Disposition for every document reviewed:**
- **Surfaced:** meets one or more pull criteria — summarize and add to the log
- **Reviewed / nothing significant:** reviewed, does not meet pull criteria — note with a one-line description

**After processing a batch, report:**

```
Document review complete.
Reviewed: [N] documents
Surfaced: [N] as potentially significant
Reviewed / nothing significant: [N]
New evidentiary gaps identified: [N]

Surfaced items:
[list with one-line description and which pull criterion triggered]
```

### Log entry format

For each surfaced item, present a log entry in chat:

```
Entry [#]
Type: [interview / document / attorney-note / gap]
Date of event: [date the event occurred]
Date logged: [today]
Source: [witness name/role, or document description]
Source type: [complainant / respondent / witness / document / attorney-note]
Issues: [which investigation issue(s) this relates to]
Significance: [high / medium / background]
Summary: [what this entry adds to the record — 2-5 sentences]
Quote: [verbatim quote if significant — otherwise omit]
Contradicts: [prior entry # or none]
Corroborates: [prior entry # or none]
Credibility note: [if applicable]
Pull criterion: [which criterion triggered — for documents only]
```

For evidentiary gaps:

```
Gap [#]
Description: [what document/source should exist but hasn't been found]
Identified from: [which entry or account raised this]
Where to obtain: [suggested source]
Priority: [high / medium / low]
Status: open
```

### Updating the sources checklist

When data added corresponds to a checklist item, ask the attorney whether to mark it complete or in progress. Do not auto-mark complete — the attorney decides when a source is adequately covered.

---

## Querying the log

When the attorney asks a question against the investigation record, answer from the log entries presented in the conversation, citing entry numbers. Answer types:

**Factual query** ("what did X say about Y"): Answer from log entries, citing entry numbers. If the log contains nothing on the topic: "I have not seen any information on [topic] in this investigation log ([N] entries reviewed). This may be worth flagging as a gap."

**Conflict query** ("where do accounts conflict"): Surface all entry contradictions. For each conflict: state what the conflict is, which entries are in tension, and what (if any) documentary evidence bears on it.

**Coverage query** ("what do we still need" / "what are our gaps"): Report sources checklist items still open, evidentiary gaps logged, and any accounts that reference sources not yet gathered.

**Strength query** ("what's the strongest evidence on each issue"): For each issue, identify the highest-significance entries, any documentary corroboration, and any unresolved conflicts. Present issue by issue.

**Upjohn query** ("have we documented Upjohn warnings"): Check the checklist and any log entries tagged as Upjohn documentation. Flag if not yet completed.

---

## Drafting the investigation memo

When the attorney asks to draft the memo, do not draft until the following are complete (warn if not):
- At least one entry for each open issue
- Complainant and respondent entries present
- Sources checklist reviewed (flag any high-priority open items)

Draft the memo in the following structure and present it in chat for attorney review:

```
MEMORANDUM — PRIVILEGED AND CONFIDENTIAL
ATTORNEY-CLIENT COMMUNICATION / ATTORNEY WORK PRODUCT

To: [Attorney to fill in]
From: [Attorney to fill in]
Date: [Date]
Re: Internal Investigation — [Matter name]
Status: PRELIMINARY DRAFT

---

## Executive Summary

[2-3 paragraphs: allegation in plain terms, investigation scope and
methodology summary, key findings in bullet form (Sustained / Not
Sustained / Inconclusive), recommended actions.]

---

## Background and Scope

Triggering event: [What initiated the investigation]

Allegations investigated:
[Each issue as a numbered allegation]

Out of scope: [Anything explicitly not investigated and why]

Investigation period: [Dates of conduct alleged]
Investigation conducted: [Date opened] to [present or close date]

---

## Methodology

Interviews conducted:
| Witness | Role | Date | Notes |
|---|---|---|---|

Documents reviewed:
[Summary of document categories reviewed, volume, date range.]

Other sources: [policies, HR records, etc. from checklist]

Limitations: [Any sources requested but not obtained, any constraints]

---

## Factual Findings

[Organized by issue — one section per allegation. Not by witness, not
purely chronological.]

### Issue 1: [Allegation]

[Narrative of what the evidence shows. Cite log entry numbers inline.
Where accounts conflict, present the conflict directly — do not smooth
it over. Documentary evidence presented with quotes where significant.]

### Issue 2: [Allegation]

[Same structure]

---

## Credibility Assessment

[Address only witnesses whose credibility is determinative — where the
finding on an issue depends on which account is credited.]

### [Witness name/role]

Internal consistency: [Consistent / Inconsistent — note specifics]
Corroboration: [What documentary or other evidence corroborates or undermines]
Motive: [Any reason to credit or discount]
Demeanor: [Attorney's observations if applicable — leave blank otherwise]
Assessment: [Credit / Do not credit / Partially credit — with basis]

---

## Relevant Policies

[Policies in effect at the time of alleged conduct. Cite the version.
Do not cite policies adopted after the conduct.]

---

## Conclusions

| Issue | Finding | Basis |
|---|---|---|
| [Issue 1] | Sustained / Not Sustained / Inconclusive | [One sentence] |

Findings are based on a preponderance of the evidence standard.

---

## Recommendations

Disciplinary action: [If any — state the basis, not just the outcome]
Policy or process changes: [If any gap in policies contributed]
Training: [If indicated]
Further investigation: [Any threads not fully resolved]
Monitoring: [Any follow-up needed]

---

## Appendix A: Chronology of Events

[All log entries sorted by date of event, not date logged.
Format: Date | Summary | Source (Entry #)]

## Appendix B: Documents Reviewed

[Summary table of all documents reviewed with disposition]
```

### Updating an existing memo

When the attorney asks to update a memo, identify which log entries were added since the last draft. Report what has changed:

```
Since the last memo draft, the following has been added to the log:

[N] new entries
New issues: [any]
New conflicts: [any]
Resolved gaps: [any]

Sections that need updating:
  Factual findings: [which issues are affected]
  Credibility: [any new credibility-relevant entries]
  Conclusions: [any findings that should be revisited]
  Appendix A: [N] new chronology entries
```

Ask: "Want me to update the full memo, or just the affected sections?" Apply updates and mark changed sections with `[UPDATED: date]` until the attorney reviews.

---

## Audience summaries

When the attorney asks for a summary for a specific audience:

**HR summary** (for HR decision on disciplinary action):
- What happened (factual summary, no legal analysis)
- Finding on each allegation (Sustained / Not Sustained / Inconclusive)
- Recommended action
- Do NOT include: privilege analysis, credibility methodology, legal exposure assessment, attorney mental impressions
- Header: "Confidential — HR Use Only — Do Not Distribute"
- Do not include entry numbers or document citations — those stay in the memo

**Leadership/Board summary** (for governance decision):
- The allegation and scope in one paragraph
- Key findings
- Business impact / exposure at a high level (no specific legal analysis)
- What the company is doing about it
- Header: "Privileged and Confidential — Attorney-Client Communication"

**Outside counsel briefing** (handing off for litigation or deeper review):
- Full context including legal exposure analysis
- Open evidentiary threads
- Credibility issues that remain contested
- Documents that would be most significant in litigation
- Header: "Privileged and Confidential — Attorney Work Product"

---

## Gate before responding to external demands or charges

**Before producing any content intended for an external response — EEOC charge response, plaintiff's-counsel demand letter response, regulator response, or any formal complaint reply** — pause and confirm with the attorney:

> Responding to a demand, charge, or complaint has legal consequences — positions taken here are admissions in later proceedings, defenses can be inadvertently waived, and privilege over the underlying investigation can be lost. Here is a brief to review before responding:
>
> - The allegation, the forum, and the deadline
> - What the investigation surfaced (findings by allegation; documents reviewed; witnesses interviewed; Upjohn warnings given or not)
> - Any unresolved evidentiary threads or credibility contests
> - What the proposed response says and what it implicitly concedes
> - Open questions and what's unresolved
> - What could go wrong: privilege waiver, inconsistent factual statements, missed affirmative defense
>
> Do not produce an external-response draft until the attorney confirms they want to proceed.

Internal memos, HR summaries, and leadership briefings used only within the organization do not trip this gate — but the privilege-formation caveat at the top of this skill still applies.

---

## What this skill does not do

- Make disciplinary decisions — it supports the attorney's findings, not HR's action decision
- Guarantee privilege — privilege depends on how the investigation is structured and used, not on how the memo is labeled
- Conduct interviews — it logs interview notes; it does not interview witnesses
- Give Upjohn warnings — it tracks whether they were given; it does not give them
- Replace attorney judgment — every finding, credibility call, and recommendation requires attorney review before it is acted upon

---

## Next steps

After completing any output, offer the attorney a short decision tree:

- **Continue gathering evidence** — add more interview notes or documents
- **Query the log** — answer a specific question against what's been gathered
- **Draft or update the memo** — synthesize the log into a formal investigation memorandum
- **Draft an audience summary** — produce an HR, leadership, or outside-counsel version
- **Close the investigation** — flag any open threads and document the close decision
- **Something else** — attorney directs the next step
