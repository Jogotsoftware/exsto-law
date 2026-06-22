---
slug: regulatory.gaps
name: Regulatory Compliance Gap Tracker
practice_area: regulatory
description: Track, triage, and report on open regulatory compliance gaps — what's flagged, who owns it, what's overdue, and what's been resolved or risk-accepted.
when_to_use: When the attorney asks about open compliance gaps, gap remediation status, wants to close or risk-accept a tracked gap, or wants to know what regulatory obligations remain unaddressed.
user_invocable: true
---

# Regulatory Compliance Gap Tracker

Every output from this skill is a draft for attorney review. It is not legal advice and does not constitute a legal opinion. The attorney owns every compliance conclusion.

**Jurisdiction assumption:** North Carolina / federal US law unless the attorney specifies otherwise. Surface this assumption explicitly when it affects the analysis.

**Verify citations before relying on them.** Regulation citations surfaced in this skill may be AI-generated and have not been checked against a primary source. Before closing or risk-accepting a gap — or citing one in an attestation, board report, or regulator response — confirm the underlying rule against a primary source (Westlaw, the issuing authority's website, or the Federal Register). Use web_search to check currency when no verified source is at hand, and flag anything unconfirmed.

---

## Purpose

Gaps get found and then forgotten. This skill tracks open regulatory compliance gaps until they are closed, and helps the attorney see what is aging, overdue, or needs a decision.

---

## Gap Record Fields

Each gap the attorney asks you to track should carry:

| Field | What it means |
|---|---|
| `ID` | Sequential identifier (e.g., GAP-001) |
| `Requirement` | What the regulation requires, in one sentence |
| `Regulation` | Name + citation |
| `Policy / area affected` | Existing policy or practice affected, or "new policy needed" |
| `Gap type` | See table below |
| `Owner` | Attorney or staff member responsible for remediation |
| `Opened` | Date the gap was identified |
| `Due` | Regulatory effective date, internal deadline, or comment deadline |
| `Rule verified` | Yes / No — whether the rule's currency has been confirmed against a primary source |
| `Status` | open / in-progress / closed / risk-accepted |
| `Resolution` | Filled in when closed or risk-accepted |

### Gap type semantics

| Type | Meaning | Urgency |
|---|---|---|
| `none` | Policy already covers the requirement. Logged for audit trail only. | No action needed. |
| `partial` | Policy addresses the topic but does not fully cover the new requirement — needs an amendment. | Remediate before effective date. |
| `full` | Policy contradicts or silently omits the new requirement — needs a rewrite or new section. | Remediate before effective date. |
| `new-policy` | No existing policy covers this. A new policy must be drafted. | Remediate before effective date. |
| `watch` | Forward-looking — ANPR, RFI, or proposed rule not yet final. No compliance obligation today; policy work waits for the final rule. The `Due` date is a revisit date, not a compliance deadline. | Monitor; revisit when final rule drops. |
| `comment-decision` | Pre-rulemaking comment decision pending — ANPR or NPRM where the firm or client is deciding whether to file a comment. `Due` is the comment deadline. | Decide within the comment window (typically 21-day warning useful). |

A `watch` or `comment-decision` entry is not a compliance gap — it is a tracking artifact for pre-rule items. Present them in their own section so the attorney can distinguish "fix this before a regulator notices" from "keep an eye on this."

---

## Modes

### Mode 1: Status Report

When the attorney asks for open gaps, a gap summary, or remediation status, produce a status report in this format:

```
## Open Compliance Gaps — [date]

### Bottom line
[N] gaps need action by [earliest due date] — top priorities: [top 3 by urgency]

---

### 🔴 Overdue
[Gaps past their due date on a verified, binding rule]

| ID | Requirement | Regulation | Policy affected | Owner | Due | Days over |
|---|---|---|---|---|---|---|

**Note:** If a rule's currency is unverified, do NOT list it as Overdue. List it under "Review needed" and note: "If this rule is in force as published, this would be overdue by [N] days. Verify rule status before escalating."

---

### 🟠 Due in < 30 days
[same table]

---

### 🟡 Open — Due > 30 days
[same table]

---

### 👀 Watch items (forward-looking — pre-rule, no current obligation)
| ID | Item | Type (ANPR/NPRM/RFI) | Revisit / Comment deadline | Owner |
|---|---|---|---|---|

---

### ✅ In Progress
[same table as open]

---

### Recently closed (last 5)
| ID | Requirement | Resolution | Closed |
|---|---|---|---|

---

**Oldest open gap:** [ID], [N] days open
**Gaps by owner:** [breakdown]

---

**Next step for each open gap:** Drafting a policy amendment or new policy section for any of these gaps is the natural next step — ask me to draft one if helpful.

---
⚠️ Citations above are AI-surfaced and may be stale or imprecise. Confirm against a primary source before relying on any gap entry in a legal submission, attestation, or board report.
```

**Never classify a gap as Overdue on an unverified rule.** The 🔴 Overdue status means "we missed a binding deadline." If the rule's currency has not been confirmed, use 🟡 "Review needed" and note the uncertainty. Route unverified-rule items to `watch` until currency is confirmed.

---

### Mode 2: Add a Gap

When the attorney identifies a new compliance gap (from a policy comparison, a new regulation, or a review), record it in chat using the gap record fields above. Assign the next sequential ID. De-duplicate: if the same requirement against the same policy already appears, note it and ask whether this is a new dimension of the existing gap or the same one.

If the attorney has not provided an owner, flag it: "No owner assigned — who is responsible for remediating this gap?"

If the firm's stated positions or escalation paths are provided in your context, apply them. If not, ask one short question or apply a conservative default and flag the assumption explicitly.

---

### Mode 3: Close a Gap

When the attorney says a gap is resolved:

1. Ask for a brief resolution note: what was done (policy updated, new policy adopted, training completed, etc.) and when.
2. Mark it closed with the resolution note and date.
3. Apply the consequential-action gate below before producing any output that certifies compliance.

**Consequential-action gate — before closing a gap or certifying compliance:**

Closing a gap as resolved, or producing any output that certifies compliance with a regulatory requirement (internal attestation, board report, audit response, regulator response), has legal consequences. A premature or incorrect closure leaves exposure unaddressed and can be used against the firm or client if later shown to be wrong.

Before treating a gap as closed:
- Confirm what the regulation actually requires (verify against a primary source).
- Confirm what the resolution actually does — and what it does not cover.
- Identify any residual gap or ambiguity.
- Note open questions.
- Note what could go wrong: overbroad certification, unresolved residual obligation, inconsistent prior position.

Present this brief to the attorney and get an explicit confirmation before marking the gap closed. Status reports and tracking views do not require this gate — only closure and compliance certifications do.

---

### Mode 4: Risk-Accept a Gap

Sometimes the answer is "we are not going to fix this, and here is why." That is a valid decision — but it must be documented.

When the attorney chooses to risk-accept a gap, record:
- **Rationale:** Why the gap is being accepted (e.g., requirement applies only to a condition the client does not meet; cost-benefit judgment; legal position that the rule does not apply).
- **Accepted by:** Name and role of the person with authority to make this call.
- **Revisit trigger:** The condition or date that should prompt re-evaluation.

A risk-accepted gap stays in the tracker — it is not deleted. It falls out of the open-gaps report but remains visible in a "risk-accepted" section so the decision and rationale are auditable.

Apply the consequential-action gate above before producing any output that treats a risk acceptance as a compliance certification.

---

## What this skill does not do

- Close gaps on its own. Closing requires the attorney's resolution note and explicit confirmation.
- Send notifications. If the attorney wants to notify a gap owner, draft the message in chat for the attorney to send.
- Confirm that a regulation is in force. Use web_search to check currency and flag any uncertainty — do not treat an AI-surfaced citation as verified.
- Replace a lawyer. Every compliance conclusion in the output is a draft for the attorney's review and judgment.

---

## Integration with other skills

- **Policy comparison (policy-diff equivalent):** If the attorney shares a policy document and a regulatory text, compare them and surface gaps in the format above — then offer to add them to the tracker.
- **Policy drafting:** For any `partial`, `full`, or `new-policy` gap, offer to draft a policy amendment or new section for attorney review.
- **Reg monitoring:** If the attorney asks you to check whether a regulation has changed or a proposed rule has been finalized, use web_search and report findings — then update the relevant `watch` entry's status.

---

## Next-steps decision tree

After producing a status report or completing a mode, offer the attorney a clear next step:

1. **Draft a policy fix** — for any `partial`, `full`, or `new-policy` gap, draft an amendment or new section.
2. **Risk-accept a gap** — document the rationale and accepted-by.
3. **Close a gap** — record the resolution note (consequential-action gate applies).
4. **Escalate an overdue item** — draft a memo or alert for the appropriate audience.
5. **Monitor a watch item** — use web_search to check whether a proposed rule has advanced.
6. **Something else** — ask the attorney what they need.
