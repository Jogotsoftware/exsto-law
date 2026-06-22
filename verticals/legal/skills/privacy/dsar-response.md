---
slug: privacy.dsar-response
name: Data Subject Access Request Response
practice_area: privacy
description: Walk through a Data Subject Access Request (access, deletion, portability, correction, or objection) and draft the acknowledgment and substantive response letters — verify identity, locate data system-by-system, assess exemptions, and produce both letters for attorney review.
when_to_use: When a client receives a DSAR, access request, deletion request, right-to-be-forgotten demand, portability request, or correction request — or when the attorney says "DSAR came in," "someone wants their data," or pastes a request email.
user_invocable: true
---

# Data Subject Access Request Response

## Before you begin

A DSAR response has a hard deadline set by the applicable privacy regime and carries real legal consequences — the content, exemptions claimed, and omissions are all reviewable by a regulator. Every output here is a **draft for attorney review, not a final response, not legal advice, and not a legal opinion.** The attorney reviews, edits, and approves before either letter goes to the data subject.

**PII handling note.** The DSAR request may contain the data subject's personal information. Do not repeat identifying details (name, email, account numbers) in headings or in any place they will be stored unnecessarily. Treat the content with care. Redact attachments or unrelated email threads the attorney has included that are not needed for the analysis.

## Jurisdiction assumption

This analysis defaults to **North Carolina / United States** when no jurisdiction is specified. Applicable US state privacy laws [verify the governing statute and deadline for the applicable jurisdiction], federal sectoral statutes (HIPAA, FERPA, COPPA, GLBA, etc.), and any applicable foreign regime (GDPR, UK GDPR) may each impose different rights, deadlines, and exemptions. If the data subject, the processing activity, or the controller is in a different jurisdiction, surface that before proceeding.

> **Always research the operative rule before asserting a deadline, right, or exemption.** Do not fill gaps with model knowledge alone. Source tiers below apply.

**Source attribution tiers.** Tag every legal citation:
- `[settled]` — stable, well-known statutory or regulatory references (e.g., GDPR Art. 15, CCPA § 1798.100). Verify before relying; lower priority.
- `[verify]` — model-knowledge citations that are real but should be confirmed: implementing regulations, agency guidance, effective dates, post-2023 amendments.
- `[verify-pinpoint]` — specific subsection letters, subpart references, pinpoint cites; highest fabrication risk — always verify against a primary source.
- `[web search — verify]` — results from web_search; must be checked against a primary source before the attorney relies on them.
- `[user provided]` — citations the attorney has given you.

If web_search returns few or no results for a regime, right, or deadline, report what was found and stop: "Search returned [N] results for [topic]. Options: (1) broaden the query, (2) flag as unverified and stop, (3) accept a model-knowledge placeholder tagged `[verify]`. Which would you like?"

## Matter context

If a matter or client is loaded in context, ground the analysis in it. If no matter is in context, ask: "Which client or matter is this for?" before proceeding — the systems list, internal SLA, and relevant contacts all depend on the firm's client record.

---

## Workflow

### Step 1: Classify the request

Identify which right(s) the data subject is invoking. Common categories:

- **Access** — copy of their data + information about processing
- **Deletion / erasure** — remove their data (subject to exemptions)
- **Portability** — their data in machine-readable format
- **Correction / rectification** — fix inaccurate data
- **Objection** — stop a particular processing activity (often marketing)
- **Restriction** — pause processing pending a dispute
- **Opt-out of sale/sharing / automated decision-making** — regime-specific (common under CCPA/CPRA and US state laws)

Some requests combine multiple rights ("delete my account and send me my data first"). Handle as two linked requests.

For each right invoked, identify the applicable jurisdiction(s). Research the controlling statute or regulation with pinpoint citations — scope of the right, carve-outs, effective dates. Flag uncertainty and surface it to the attorney rather than asserting a rule unconfirmed.

### Step 2: Verify identity

**Calibrate to risk.** Over-verifying is a barrier (bad look with regulators). Under-verifying risks handing data to the wrong person.

Common verification approaches:
- **Logged-in / authenticated session** — identity confirmed
- **Email match** — request from email on file → generally sufficient for low-risk requests
- **Additional step** — high-value accounts or deletion requests may warrant a challenge question, phone verification, or ID document check

Ask the attorney: "How does the client verify identity for DSARs? (Logged-in session, email match, or additional step?)" Apply that approach. If none is specified, default to email match for low-risk requests and flag that a stronger method may be appropriate for deletion.

If identity cannot be verified, draft this pause notice (attorney sends promptly — do not wait):

```
We were unable to verify that this request came from the individual whose data
is at issue. To proceed, please [verification step]. We cannot provide personal
data in response to a request we cannot verify.
```

**Clock note.** The response clock generally starts on receipt of the request, not on completion of identity verification — unless the applicable regime says otherwise. Do not silently toll the clock on verification. `[verify]` this rule per the applicable regime.

### Step 3: Locate the data

Walk through every system where the client processes personal data. Ask the attorney to supply the systems list for this client if it is not in context; flag that a complete DSAR cannot be done without knowing where to look.

Use this table to document the search:

| System | Queried? | Data found? | What |
|---|---|---|---|
| Production / main database | | | |
| CRM (e.g., Clio, HubSpot) | | | |
| Email / calendar | | | |
| Support / ticketing | | | |
| Analytics / reporting tools | | | |
| Marketing / email tools | | | |
| Logs | | | |
| Backups | | | (note: often exempt from deletion — see Step 4) |
| Third-party processors / vendors | | | (may need to be notified for deletion) |

**B2B note.** If the client is a data processor for their own customers, check whether this DSAR belongs to the processor or to the underlying controller (the client's customer). Many processor agreements require forwarding DSARs to the controller rather than responding directly.

### Step 4: Exemption analysis

Research each applicable exemption before asserting it. For each item that may be withheld or retained, identify every exemption with a plausible good-faith basis under the applicable regime: third-party privacy, privilege, trade secret, security, legal retention obligation, establishment or defense of legal claims, transactional necessity, backup rotation accommodations, freedom of expression.

Cite the controlling statute or regulation with a pinpoint cite. Flag uncertainty.

**Do not narrow the exemption list on your own.** Propose exemptions where a good-faith basis exists; the attorney narrows before the response goes out. Dropping an exemption that later applies is costly — once data is disclosed, that exemption is functionally gone. Over-asserting a plausible exemption is correctable by the attorney in review.

Every proposed exemption carries this note: **"Proposed — requires attorney review before asserting. Regulators scrutinize blanket exemption claims; the attorney narrows this list, not the assistant."**

Common questions to work through:
- Does the record contain data about *other* people that must be redacted before production?
- Is there a specific legal retention obligation blocking deletion? (Cite it.)
- Is there an active litigation hold covering this individual's data? (Deletion + lit hold = conflict; the attorney decides.)
- Are there backup rotation or technical-feasibility accommodations that need to be documented (not used as a general excuse)?

Document every exemption claimed with its basis. If a regulator asks why data was not deleted, "we had a legal obligation" needs a citation.

### Step 5: Draft the response — two letters

Every DSAR produces two separate documents: an **acknowledgment letter** (sent promptly after receipt) and a **substantive response letter** (sent by the statutory deadline). Do not collapse them. Sending only a combined letter on day 45 is a process failure even if it is substantively correct.

**Internal reviewer note** (for the attorney, not sent to the data subject): Attach a brief cover note listing sources used, any unverified citations, proposed exemptions requiring attorney review, and any open questions. The two letters below are externally-facing — do not include internal notes or work-product headers on the letters themselves.

> **Before either letter goes to the data subject:** This is a draft for attorney review. Sending commits the client to a position, may waive exemptions, and may start a regulator's clock. The attorney reviews, edits, and approves before anything goes out.

#### Step 5a — Acknowledgment letter

Send this promptly — target same-day to 3–5 days after receipt, well inside the statutory window. Confirms receipt, states the controller's understanding of the request, states the response deadline, and notes any outstanding identity verification.

```
Subject: We received your privacy request — [Firm/Client Name] — [Date]

Dear [Name],

We received your [access / deletion / portability / correction] request on [date received].

**Your request, as we understand it:** [one-sentence restatement — e.g., "a copy of
all personal data we hold associated with your account, along with the categories
of third parties with whom we share it, and deletion of your account after we
provide the copy."]

**What happens next:**
- Our target date for the substantive response is [date — no later than the regime's
  statutory deadline; use internal SLA if tighter].
- [If identity verification is outstanding: "We need [specific verification step]
  before we can proceed — please see below."]
- If we need additional time because the request is complex or we receive multiple
  requests from you at the same time, we will notify you before the initial deadline
  and explain why. [If the regime permits an extension, cite the provision.]
- No fee applies to this request. [Or: note any fee only if the regime permits it
  and the request is manifestly unfounded or excessive — cite the provision.]

[If identity verification is outstanding:]
**To verify your identity,** please [specific step — e.g., reply to this email
from the address on file with the last four digits of the payment method we have
on record]. This does not pause our response deadline; we continue to work in
parallel.

If you have questions, contact [privacy contact name and email].

[Signature]
```

#### Step 5b — Substantive response letters

Send by the statutory deadline (or the internal SLA if tighter), only after identity verification is complete and the Step 3 / Step 4 analysis is done.

**Access request response:**

```
Subject: Your Data Access Request — [Firm/Client Name] — [Date]

We received your request on [date] for a copy of the personal data we hold about you.

**What we found:**

We hold the following categories of personal data associated with [identifier]:

| Category         | Source       | Purpose                      | Retained until    |
|------------------|--------------|------------------------------|-------------------|
| Account info     | You, signup  | Account management           | Account deletion  |
| [Usage data]     | Our service  | Analytics, product improvement | [period]        |
| [Correspondence] | You          | Customer support             | [period]          |

**Your data is attached** in [format]. [Secure delivery note — password-protected
archive, expiring secure link, etc.]

**Third parties:** We share data with the following processors: [list or link].

**Your other rights:** You may also request [deletion / correction / portability].
To do so, [method].

**Data we did not include:**
- [Category] — [exemption and reason, e.g., "internal security logs — disclosure
  would compromise security measures"]
- [Data about other individuals has been redacted from correspondence]

If you have questions about this response, contact [privacy contact name and email].

[Signature]
```

**Deletion request response:**

```
Subject: Your Deletion Request — [Firm/Client Name] — [Date]

We received your request on [date] to delete the personal data we hold about you.

**What we deleted:**

| Category             | System           | Deleted on |
|----------------------|------------------|------------|
| Account and profile  | Production       | [date]     |
| [Analytics events]   | [Tool name]      | [date]     |

**What we retained and why:**

| Category              | Reason                                                      | Retained until    |
|-----------------------|-------------------------------------------------------------|-------------------|
| [Transaction records] | Legal retention obligation ([cite law]) `[verify]`          | [date]            |
| [Backup snapshots]    | Will be deleted on next rotation cycle                      | [next rotation]   |

**Third-party processors:** We have instructed [list] to delete your data.

Your account is now closed. If you have questions, contact [privacy contact].

[Signature]
```

### Step 6: Document the DSAR

DSARs get audited. Recommend that the attorney record (in Clio or the firm's preferred tool, or presented here for the attorney to save):

- Date received
- Date identity verified
- Date acknowledgment sent
- Date substantive response sent
- What was produced or deleted
- Exemptions claimed and legal basis for each
- Who handled it

Present this summary in chat; the attorney saves it to the matter file.

---

## Escalation triggers

Route to the attorney immediately (before completing the workflow) when:

- The requester is — or may be — a plaintiff, opposing counsel, journalist, or regulator
- The request scope is unusual ("all data including internal communications about me")
- There is an active litigation hold on this individual's data AND a deletion request (conflict — attorney decides)
- The requester is disputing a previous DSAR response
- Any regulator is cc'd or mentioned in the request

---

## Deadline management

Research the currently operative response deadline for the specific right invoked and the applicable jurisdiction(s). Check whether an extension mechanism exists, how much additional time it provides, and what notice the data subject must receive. Identify when the clock starts (default: receipt of the request — verify per regime). Cite the controlling statute or regulation with pinpoint references. Flag effective dates; state privacy response timelines are amended frequently.

If the attorney tells you the firm's internal SLA (e.g., "we aim to respond in 30 days"), use that as the working deadline and note the legal backstop.

If an extension will be needed, the "we need more time" notice must go out well before the first deadline. A day-of extension looks bad to regulators.

---

## What this skill does not do

- It does not query the client's systems directly. It walks through the checklist; the attorney or the client's team does the actual data queries. Where the attorney provides documents or data exports, incorporate them.
- It does not make exemption calls on close questions — it proposes and flags; the attorney decides.
- It does not send the letters. Draft → attorney review → attorney sends.
- It does not have access to Westlaw, CoCounsel, or other legal research platforms. Use web_search for statute and regulation lookup, tag results `[web search — verify]`, and flag anything that must be confirmed against a primary source before the attorney relies on it.
