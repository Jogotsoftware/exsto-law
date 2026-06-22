---
slug: litigation.legal-hold
name: Legal Hold Notice
practice_area: litigation
description: Draft, refresh, release, and report on litigation hold notices — covers custodian scoping, notice language, refresh cadence, departed-custodian handling, and portfolio-wide hold status.
when_to_use: When the attorney needs to issue, refresh, or release a litigation hold, or wants a status report on which active matters have holds outstanding, overdue, or missing.
user_invocable: true
---

# Legal Hold Notice

## Purpose

A legal hold is the most operationally high-stakes document in litigation practice. The notice itself is templated. The failure modes are procedural: issued too late, scoped too narrowly, never refreshed, never released. This skill covers all four phases: **issue → refresh → release → track**.

Every output from this skill is a draft for attorney review. Nothing here is legal advice or a legal opinion. The attorney owns the legal conclusion and issues the final notice.

## Jurisdiction assumption

Preservation duties vary materially by forum. Federal common law (Zubulake / Residential Funding / Rule 37(e)) differs from state practice; states differ from each other on trigger timing, scope, sanctions, and spoliation remedies; regulatory preservation obligations overlay civil rules in some matters (SEC Rule 17a-4, HIPAA, etc.). Default to North Carolina practice when no forum is specified, but surface that assumption explicitly and confirm with the attorney before issuing, refreshing, or releasing.

If the firm has stated positions on hold scope, refresh cadence, signer authority, or privilege markings in your current context, apply them. If a position is not in context, ask the attorney one short question or apply a conservative default and flag the assumption clearly.

## Privilege and confidentiality

Hold notices are attorney-client communications. Do not help paste the text of a draft notice, the custodian list, or the matter facts into any channel outside the attorney-client privilege circle. If asked to share a draft notice with a non-attorney recipient, flag the destination before proceeding.

## Modes

Ask which mode is needed if not stated. The four modes are: **issue**, **refresh**, **release**, and **status**.

---

### Issue — first issuance

**When to use:** the matter is active or litigation is reasonably anticipated and no hold has been issued yet.

**Consequential act gate.** Issuing a hold triggers preservation obligations the company or client will be judged on in any later spoliation argument, and the notice itself may be discoverable. Present the full draft notice in chat for attorney review before the attorney distributes it. Do not treat a drafted notice as an issued one.

**Research the applicable preservation rule first.** Before drafting, identify:
- The forum (federal court, North Carolina state court, regulatory proceeding, or other)
- The source of the preservation duty (common law, Rule of Civil Procedure, regulatory obligation, contractual)
- The operative trigger standard (when the duty attaches)
- The scope standard (what must be preserved)
- Sanctions exposure (the spoliation doctrine for the forum)

Use web_search and any documents the attorney provides. Cite primary sources. Note that federal and state law can differ materially on trigger timing and remedy — flag the forum you are relying on explicitly. If uncertain, say so and recommend outside-counsel sign-off before issuing.

**Inputs to gather** (ask if not already in context):

1. **Matter** — which matter/client is this hold for? If a matter is active in your context, confirm it is the right one.
2. **Scope** — categories of documents, data, and communications to preserve. Start specific: contracts with counterparty, all communications referencing [project/subject], related financial records, calendar entries. Flag: scope too broad creates operational burden; scope too narrow creates spoliation risk — the attorney confirms scope.
3. **Custodians** — named individuals likely to hold responsive material. Suggest based on matter context (business lead, HR partner if employment, CISO if data breach, etc.) and ask the attorney to confirm. The custodian list is what the company will be judged on if a gap is later argued.
4. **Date range** — preservation start (usually the triggering event or earlier) through the present, ongoing.
5. **Systems** — email, Slack/Teams, file shares, personal devices (BYOD if applicable), project management tools, CRM, legacy systems.
6. **Urgency** — if litigation is already filed or a demand letter threatening suit has been received, the hold goes out immediately.
7. **Effective date** — date of the hold.
8. **Signer** — who signs the notice (supervising attorney or GC by default; confirm).

**Draft the notice** using the template below, or a firm template if one is provided in context.

**Default hold notice template:**

```
[PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION]

DATE: [effective date]
TO: [custodian name]
FROM: [signer name and title]
RE: LITIGATION HOLD NOTICE — [matter short name]

You are receiving this notice because [firm/company] has determined that
[one-sentence description of the dispute or investigation, avoiding
prejudicial detail]. The law requires preservation of documents and
communications potentially relevant to this matter.

EFFECTIVE IMMEDIATELY, you must preserve:

1. All documents, emails, text messages, Slack/Teams messages, and other
   communications relating to [scope item 1].
2. [scope item 2]
3. [scope item 3]

This preservation obligation applies to:
- Email (including sent, archived, and deleted folders)
- Slack, Teams, and other messaging platforms
- Shared drives and cloud storage
- Personal devices used for business (BYOD)
- Paper documents
- Voicemails
- Calendar entries and meeting notes

DO NOT:
- Delete, modify, destroy, or dispose of any potentially responsive material
- Allow auto-delete or scheduled purge to run on any covered account or device

Coordinate with [legal contact] before sharing this notice with direct
reports or IT.

Direct questions about this notice or your preservation obligations to
[legal contact]. You may continue to discuss the underlying business
subject matter with colleagues as needed for your work, but do not discuss
this legal notice, the litigation, or legal strategy with anyone outside
the privilege circle.

IF YOU ARE UNSURE whether something is covered, ERR ON THE SIDE OF
PRESERVING.

Please acknowledge receipt of this notice by [reply / confirmation form]
within three business days. If you have questions, contact [signer email].

This notice remains in effect until you receive written notice of its
release. You may be asked to reaffirm compliance at periodic intervals.

[Signer signature block]
```

**After presenting the draft in chat**, append this review note (strip before the attorney distributes the notice):

> **Attorney review required before issuance.** This is a draft litigation hold notice, not a notice ready to distribute. Issuing a hold triggers preservation obligations the client will be judged on in any later spoliation argument, and this notice may itself be discoverable. Review, approve, and issue as the supervising attorney. Do not distribute this draft unreviewed.

Present the custodian list, the scope summary, and the next-refresh date (default: issued date + 6 months) alongside the notice so the attorney has a complete record to save in the matter.

---

### Refresh — periodic reaffirmation

**Default cadence:** 6 months from issuance, then every 6 months. Flag if the attorney requests a different cadence.

When the attorney asks you to refresh a hold, or flags that a refresh is due:

**Inputs to gather:**
1. Any scope changes since last refresh (new topics surfaced in discovery, new custodians, new systems).
2. Any custodians to add or remove.
3. Whether any custodians have departed — see below.

**Draft a refresh notice** using the same template, opening with: "This is a reaffirmation of the litigation hold originally issued [date] in the matter of [name]. The terms below supersede and replace the prior notice."

List the current custodians (amended if needed) and the current scope. Request re-acknowledgment within three business days.

**Departed custodians:** if a custodian has left the organization since the last refresh, flag this as a separate preservation action item — the departing employee's files and email archive need to be preserved at the IT/system level, not just via notice to the individual. Note it explicitly in the refresh output so the attorney can direct IT.

Present the refresh notice and the updated custodian list in chat for the attorney to review, save, and distribute.

---

### Release — closing the hold

**Consequential act gate.** Once released, custodians may begin deleting material under normal retention. Releasing at the wrong time creates spoliation exposure. Before drafting a release notice, confirm:

1. The matter is truly closed — not on appeal, not likely to reopen, no related claims with live statutes of limitations.
2. The attorney (or GC) has authorized release.
3. What happens to the preserved material — return to normal retention, continue preserving for a defined period, or transfer to archive?

Present the release notice draft in chat with this note:

> **Attorney authorization required before release.** Release allows custodians to resume normal deletion. Confirm the matter is fully closed and all related-claim and appeal windows have passed before distributing this notice.

**Release notice template:**

```
[PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION]

DATE: [release date]
TO: [custodian name]
FROM: [signer name and title]
RE: RELEASE OF LITIGATION HOLD — [matter short name]

The litigation hold issued [original issue date] regarding [matter short
name] is hereby released effective [release date].

[If retaining material]: Notwithstanding this release, you are instructed
to retain [category of material] until [date / further notice] per
[reason].

[Otherwise]: Normal document retention policies resume as of the release
date.

Please contact [legal contact] with any questions.

[Signer signature block]
```

---

### Status — hold portfolio report

When the attorney asks for a hold status overview across their matters, produce a report in the following format based on the matter information available in context. If matter/hold details are not in context, ask the attorney to describe the active matters and their hold status, or provide a list.

```markdown
# Litigation Hold Status — [today's date]

## Active holds

| Matter | Issued | Last Refresh | Next Refresh | Custodians | Status |
|---|---|---|---|---|---|
| [matter name] | [date] | [date] | [date] | [N] | OK / REFRESH DUE / OVERDUE |

## Attention items

- **Refresh overdue:** [list matters where next refresh date has passed]
- **Refresh due within 30 days:** [list]
- **Active matters without a hold issued:** [list — flag as high risk]
- **Closed matters with hold still active:** [list — consider release]

## Recently released

[Last released holds with dates, if known]
```

Flag active-without-hold matters as high risk. A matter that is active or in reasonable anticipation of litigation without an issued hold is the most common source of sanctions exposure.

---

## What this skill does not do

- **Enforce preservation.** The skill drafts and tracks notices; IT and custodians preserve. Departed-custodian flags are surfaced for the attorney to direct IT — the skill does not reach into systems.
- **Make scope calls alone.** The skill proposes scope from matter context; the attorney confirms. Scope is a judgment call the attorney owns.
- **Auto-refresh without review.** Every refresh notice requires attorney review before distribution, even on routine cadence.
- **Access Westlaw, Ironclad, or other external research/contract platforms.** Use web_search and documents the attorney provides. Note the limits of web-accessible sources for primary-law research and recommend attorney verification of any cited rule.
- **Send the notice.** The draft is presented in chat. The attorney copies, formats, and sends via email per firm convention.
