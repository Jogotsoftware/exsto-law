---
slug: employment.internal-investigation
name: Internal Investigation
practice_area: employment
description: Guide the attorney through an internal investigation from intake through findings memo — privilege framing, source checklists, document review, log building, memo drafting, and audience summaries.
when_to_use: When the attorney opens, advances, or closes an internal investigation (harassment, financial misconduct, executive misconduct, or whistleblower retaliation), needs to review documents against a matter, or wants to draft investigation findings.
user_invocable: true
---

# Internal Investigation

> **Every output this skill produces is a draft for attorney review — not legal advice, not a legal opinion, and not a substitute for attorney judgment.** The attorney owns every legal conclusion, every finding of fact, and every disciplinary recommendation.

---

## Privilege notice — read before proceeding

**Marking does not create privilege.** Labels like "Attorney Work Product" or "Attorney-Client Privileged" reflect intended protection — they do not themselves establish it. Whether any given output is actually privileged depends on whether the investigation is attorney-directed, the purpose for which documents are created, and how they are subsequently used or disclosed.

**Before opening an investigation, confirm:** Is this investigation attorney-directed? If HR is running it with legal only in an advisory role, or if it was not initiated at the direction of counsel for the purpose of obtaining legal advice, the privilege analysis changes materially. Flag that question before creating any log or memo.

**Distribution discipline.** Every document this skill helps produce — log entries, memo drafts, audience summaries, document notes — inherits the privilege and confidentiality status of the underlying investigation. Distribution beyond the privilege circle (forwarding to non-attorneys outside the investigation team, cc'ing HR without scoping, handing to the business side) can waive privilege over the entire investigation. Make every distribution decision deliberately.

If there is any doubt about privilege applicability, resolve it before investigation files are created. Improperly labeled materials can create problems in discovery if privilege is later challenged.

---

## Jurisdiction assumption

Default to North Carolina law and federal law (Title VII, FLSA, NLRA, Sarbanes-Oxley, Dodd-Frank, etc.) unless you know the matter is in another jurisdiction. Surface this assumption explicitly at intake and flag if the matter has multi-state or multi-jurisdiction dimensions.

---

## Matter context

If a matter or client is already loaded in context, ground all outputs in that matter. If no matter is in context, ask: "Which matter is this investigation for?" before proceeding. Do not mix information across matters.

---

## Purpose

Internal investigations fail in two ways: **coverage gaps** (sources never gathered) and **synthesis gaps** (evidence gathered but never connected). This skill handles both — it tracks what has and has not been gathered, processes document batches to surface what matters, and maintains a structured log that can be turned into a privileged memo at any point.

---

## Mode 1: Open a new investigation

Triggered when the attorney says "open an investigation," "start an investigation into," or similar.

### Step 1 — Intake

Ask the following in a single block:

> To open the investigation log I need a few things:
>
> **The matter**
> - What is the allegation or concern in plain terms?
> - Who is the complainant (or what triggered this — complaint, tip, audit, manager observation)?
> - Who is the respondent or subject?
> - What is the approximate timeframe the alleged conduct occurred?
> - Is this attorney-directed? (If yes: work-product protection applies. If no: flag privilege risk before proceeding.)
>
> **Investigation type** (helps generate the right sources checklist):
> - HR: harassment / discrimination / retaliation
> - Financial misconduct: expense fraud / procurement irregularities / embezzlement
> - Executive misconduct: conflict of interest / undisclosed relationships / governance failures
> - Whistleblower: retaliation for protected activity
> - Other: describe briefly
>
> **Representation and employer status** (surfaces parallel legal frameworks that change interview procedure):
> - Is the respondent, complainant, or any anticipated witness represented by a union or covered by a collective bargaining agreement? (If yes, flag for Weingarten research — representational rights at investigatory interviews may apply and change the interview protocol.)
> - Is the employer a public employer (government entity, public university, state or municipal agency) or otherwise acting under color of state law? (If yes, flag for Garrity research — compelled statements in public-sector investigations have special use-immunity consequences that change how interviews must be conducted and documented.)

If either flag fires, research the applicable rules (NLRA / state public-sector labor statutes for Weingarten; 5th Amendment and the Garrity line of cases plus any North Carolina analogs) using web_search before conducting interviews. Cite primary sources. Verify currency. Do not assist with interview planning until the protocol is adjusted.

### Step 2 — Present the investigation summary

Present the following to the attorney in chat for review:

```
INVESTIGATION LOG (DRAFT — ATTORNEY WORK PRODUCT)
Matter: [matter name]
Opened: [date]
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

Evidentiary gaps: [none yet]
```

Ask the attorney to confirm the issues before proceeding.

### Step 3 — Sources checklist

Generate the checklist for the investigation type and present it in chat. Ask: "Does this fit your matter? Let me know if any items are not applicable or if there are additional sources specific to this situation."

**HR investigation sources (harassment/discrimination/retaliation):**

1. Complainant interview
2. Respondent interview
3. Witness interviews — identify from complainant and respondent accounts
4. Email/messaging review — parties, relevant date range
5. HR records — respondent's performance history, prior complaints, prior discipline
6. Prior complaints — any prior complaints against respondent in HR system
7. Comparator data — how were similar situations handled
8. Relevant policies — harassment, code of conduct, reporting procedures (version in effect at time of alleged conduct)
9. Org chart and reporting relationships at time of alleged conduct
10. Calendar records — any meetings or events mentioned in accounts
11. Upjohn warning documentation — confirm interviews were preceded by Upjohn warnings and documented

**Financial misconduct sources:**

1. Expense reports — subject, relevant period
2. Approval records — who approved the expenses or transactions
3. Vendor/contractor records — contracts, invoices, payment records
4. Financial system records — AP/GL entries for relevant accounts
5. Email/messaging review — subject, approvers, counterparties
6. Subject interview
7. Approver interviews
8. Counterparty/vendor interviews (if accessible)
9. Audit logs — system access logs for relevant accounts/systems
10. Prior audits or reviews covering the relevant period
11. Upjohn warning documentation

**Executive misconduct sources:**

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

**Whistleblower sources:**

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

Present the checklist with open/complete/N-A status for each item. Track updates in chat as the attorney confirms status.

---

## Mode 2: Add data to the investigation

Triggered when the attorney says "add to the investigation," "here are interview notes," or pastes documents/notes.

### Step 1 — Identify the matter and data type

If it is not clear from context, ask:
- Which matter does this data belong to?
- What type of data is this? (Interview notes, document batch, attorney notes/observations, Upjohn warning confirmation)
- Whose interview / what documents?

### Step 2 — Document pull criteria

For any document batch, apply the following criteria. A document is surfaced if it meets **any** of the following. These are set to pull slightly aggressively — it is better to surface a false positive than to miss a significant item.

1. Contains the name of any party to the investigation (complainant, respondent, named witnesses)
2. Was authored or received by a party during the key conduct timeframe
3. Contains keywords related to the allegation type (build and update the keyword list from accounts as the investigation develops)
4. Contains explicit or implicit admissions ("I shouldn't have," "I know how this looks," "don't put this in writing," "delete this")
5. Contains language contradicting any account already in the log — flag the specific contradiction and what it conflicts with
6. Contains language that would be sensitive in litigation: discriminatory terms, threats, discussions of protected characteristics or activities, financial irregularities matching the allegation pattern
7. Is a document type mentioned in prior accounts but not yet reviewed (e.g., a meeting was mentioned in an interview but no calendar invite has appeared) — log as an evidentiary gap, not a surfaced document

**Disposition for every document reviewed:**
- `Surfaced` — meets one or more pull criteria; included in the log with analysis
- `Reviewed / nothing significant` — reviewed, does not meet pull criteria; noted with a one-line description

**After processing a document batch, report:**

```
Document review complete.
Reviewed: [N] documents
Surfaced: [N] as potentially significant
Reviewed / nothing significant: [N]
New evidentiary gaps identified: [N]

Surfaced items:
[list — one line per item with description and which pull criterion triggered]
```

Note: this skill can only review documents and text pasted into the conversation. If files are in formats that cannot be read here, flag them for manual review.

### Step 3 — Log entries

For each surfaced item, present a log entry:

```
LOG ENTRY [auto-number]
Type: [interview / document / attorney-note / gap]
Date of event: [when the event occurred — not when logged]
Date logged: [today]
Source: [witness name/role, or document description]
Source type: [complainant / respondent / witness / document / attorney-note]
Issue(s): [which investigation issue(s) this relates to]
Significance: [high / medium / background]
Summary: [what this entry adds to the record — 2–5 sentences]
Quote: [verbatim quote if significant — otherwise leave blank]
Contradicts: [prior entry number, if applicable]
Corroborates: [prior entry number, if applicable]
Credibility note: [leave blank until assessed]
Pull criterion: [for documents — which criterion triggered]
```

For evidentiary gaps:

```
GAP [auto-number]
Description: [what document/source should exist but has not been found]
Identified from: [which log entry or account raised this]
Where to obtain: [suggested source]
Priority: [high / medium / low]
Status: Open
```

### Step 4 — Update sources checklist

After adding data, flag which checklist items are now complete or in-progress. Do not mark items complete without asking the attorney — the attorney decides when a source is adequately covered.

---

## Mode 3: Query the investigation log

Triggered when the attorney asks a question against the investigation (e.g., "what did [witness] say about X," "what documents corroborate," "what do we still need," "what is the strongest evidence on each side").

Review all log entries you have been given or that are in context before answering. Answer types:

**Factual query** ("what did X say about Y"):
Answer from the log entries, citing entry numbers. If the log contains nothing on the topic: "I have not seen any information on [topic] in this investigation log ([N] entries reviewed). This may be worth flagging as a gap."

**Conflict query** ("where do accounts conflict"):
Surface all contradictions. For each conflict: state what the conflict is, which entries are in tension, and what (if any) documentary evidence bears on it.

**Coverage query** ("what do we still need" / "what are our gaps"):
Report checklist items still open and evidentiary gaps logged. Note any accounts that reference sources not yet gathered.

**Strength query** ("what is the strongest evidence on each issue"):
For each issue, identify: the highest-significance log entries, any documentary corroboration, and any unresolved conflicts. Present issue by issue.

**Upjohn query** ("have we documented Upjohn warnings"):
Check for Upjohn log entries and checklist status. Flag if not yet completed.

---

## Mode 4: Draft or update the findings memo

Triggered when the attorney says "draft the memo," "update the memo," or similar.

### First draft

Do not draft until the following are complete (warn if not):
- At least one log entry for each open issue
- Complainant and respondent entries present
- Sources checklist reviewed (flag any high-priority open items)

Draft the memo in the following structure:

```markdown
ATTORNEY WORK PRODUCT — PRIVILEGED AND CONFIDENTIAL
Prepared at the Direction of Counsel

---

MEMORANDUM

To:     [Attorney to complete]
From:   [Attorney to complete]
Date:   [Date]
Re:     Internal Investigation — [Matter name]
Status: PRELIMINARY DRAFT

---

## Executive Summary

[2–3 paragraphs: allegation in plain terms, investigation scope and methodology summary,
key findings in bullet form (Sustained / Not Sustained / Inconclusive), recommended
actions. Draft this section last but place it first.]

---

## Background and Scope

**Triggering event:** [What initiated the investigation]

**Allegations investigated:**
[Each issue as a numbered allegation]

**Out of scope:** [Anything explicitly not investigated and why]

**Investigation period:** [Dates of conduct alleged]
**Investigation conducted:** [Date opened] to [present or close date]

---

## Methodology

**Interviews conducted:**
| Witness | Role | Date | Notes |
|---|---|---|---|
[Populated from interview log entries]

**Documents reviewed:**
[Summary of document categories, volume, date range. Full document log maintained separately.]

**Other sources:**
[Policies, HR records, etc. from checklist]

**Limitations:** [Any sources requested but not obtained; any constraints]

---

## Factual Findings

*[Organized by issue — one section per allegation. Not by witness, not purely chronological.]*

### Issue 1: [Allegation]

[Narrative of what the evidence shows on this issue. Cite log entry numbers inline in brackets.
Where accounts conflict, present the conflict directly — do not smooth it over. Documentary
evidence presented with quotes where significant.]

### Issue 2: [Allegation]

[Same structure]

[Continue for each issue]

---

## Credibility Assessment

*[Standalone section. Address only witnesses whose credibility is determinative — i.e.,
where the finding depends on which account is credited.]*

### [Witness name/role]

**Internal consistency:** [Consistent / Inconsistent — note specifics]
**Corroboration:** [What documentary or other evidence corroborates or undermines the account]
**Motive:** [Any reason to credit or discount the account]
**Demeanor:** [Attorney's observations from interviews — leave blank if not applicable]
**Assessment:** [Credit / Do not credit / Partially credit — with basis]

---

## Relevant Policies

[Policies in effect at the time of alleged conduct that bear on the issues. Cite the version.
Do not cite policies adopted after the conduct.]

---

## Conclusions

| Issue | Finding | Basis |
|---|---|---|
| [Issue 1] | Sustained / Not Sustained / Inconclusive | [One sentence] |
| [Issue 2] | ... | ... |

*Findings are based on a preponderance of the evidence standard.*

---

## Recommendations

**Disciplinary action:** [If any — state the basis, not just the outcome]
**Policy or process changes:** [If any gap in policies contributed]
**Training:** [If indicated]
**Further investigation:** [Any threads not fully resolved]
**Monitoring:** [Any follow-up needed]

---

## Appendix A: Chronology of Events

[Events sorted by date of occurrence, not date logged.
Format: Date | Summary | Source (Entry number)]

## Appendix B: Documents Reviewed

[Summary table of documents reviewed, disposition, and significance]
```

Present the draft in chat for the attorney to review, copy, and save in the app.

### If a draft already exists — update

Review the existing memo and the log. Identify log entries added since the memo was last drafted. Report what has changed:

```
Since the last memo draft ([date]), the following was added to the log:

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

Ask: "Want me to update the full memo, or just the affected sections?" Apply updates. Mark changed sections with `[UPDATED: date]` until the attorney reviews.

---

## Mode 5: Draft audience summary

Triggered when the attorney says "draft a summary for [audience]."

Ask: who is the audience and what decision or action does this summary support?

**HR summary** (for HR decision on disciplinary action):
- What happened — factual summary only, no legal analysis
- Finding on each allegation (Sustained / Not Sustained / Inconclusive)
- Recommended action
- What is NOT in this summary: privilege analysis, credibility methodology, legal exposure assessment, attorney mental impressions
- Header: "Confidential — HR Use Only — Do Not Distribute"
- Do not include log entry numbers or document citations — those stay in the memo

**Leadership/Board summary** (for governance decision):
- The allegation and scope in one paragraph
- Key findings
- Business impact / exposure — high level only, no specific legal analysis
- What the company is doing about it
- Header: "Attorney Work Product — Privileged and Confidential"

**Outside counsel briefing** (handing off for litigation or deeper review):
- Full context including legal exposure analysis
- Open evidentiary threads
- Credibility issues that remain contested
- Documents that would be most significant in litigation
- Header: "Attorney Work Product — Privileged and Confidential"

Present the summary in chat for the attorney to review and distribute.

---

## Consequential-action gate

**Before producing a summary or memo intended for an external response** — EEOC charge response, plaintiff's-counsel demand letter response, state agency response, or any formal complaint reply — stop and ask:

> Responding to a demand, charge, or complaint has legal consequences — positions taken here are admissions in later proceedings, waivers of defenses can be inadvertent, and privilege over the underlying investigation can be lost. Has this response been reviewed with you as the attorney of record, or with outside counsel if needed? If yes, proceed. If no, prepare the following brief for that review:
>
> - The allegation, the forum, and the deadline
> - What the investigation surfaced (findings by allegation; documents reviewed; witnesses interviewed; Upjohn warnings given or not)
> - Any unresolved evidentiary threads or credibility contests
> - What the proposed response says and what it implicitly concedes
> - Open questions that remain unresolved
> - What could go wrong (privilege waiver, inconsistent factual statements, missed affirmative defense)

Do not produce an external-response draft past this gate without an explicit yes from the attorney. Internal memos, HR summaries, and leadership briefings used only within the organization do not trip this gate (but the privilege-formation caveat at the top of this skill still applies).

---

## What this skill does NOT do

- **Make disciplinary decisions** — it supports the attorney's findings, not HR's action
- **Guarantee privilege** — privilege depends on how the investigation is structured, not on how the memo is labeled
- **Conduct interviews** — it logs interview notes and helps prepare interview outlines; it does not interview witnesses
- **Access Westlaw, Pacer, or legal research databases** — for case law and statutory research, use web_search and provide the sources for attorney review
- **Replace Upjohn warnings** — it tracks whether they were given; the attorney gives them
- **Review files it cannot read** — documents must be pasted or described in the conversation; files in formats not readable here are flagged for manual review

---

## Next steps

After each output, offer the attorney a short decision tree:

> What would you like to do next?
> 1. Add more data to the investigation log
> 2. Query the log (ask a specific question about what has been gathered)
> 3. Draft or update the findings memo
> 4. Draft an audience summary
> 5. Review open gaps and checklist status
> 6. Something else — describe it
