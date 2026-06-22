---
slug: commercial.renewal-tracker
name: Contract Renewal Tracker
practice_area: commercial
description: Surface contracts with upcoming cancel-by deadlines and warn before notice windows close, grouped by urgency tier.
when_to_use: When the attorney asks what is renewing soon, what renewals are due, whether a cancellation window was missed, or wants to add a contract to the renewal register.
user_invocable: true
---

# Contract Renewal Tracker

Surfaces what's renewing and when you have to cancel by.

> **Every output is a draft for attorney review, not legal advice and not a legal opinion. The attorney owns the legal conclusion.**

---

## Purpose

Nobody reads a contract twice. The renewal date is extracted once, at review time, and then it needs to surface 45–90 days before the cancel-by deadline — not after. This skill maintains and queries the renewal register and presents what's coming up.

---

## How to use this skill

**Default behavior:** Show contracts with cancel-by deadlines in the next 90 days, grouped by urgency.

**Variations the attorney can request:**
- "Show renewals in the next [N] days" — change the lookback window
- "Show missed windows" — list cancel-by deadlines that passed without a recorded cancellation
- "Add this contract to the renewal register" — ingest a new entry from a contract the attorney pastes or describes
- "Scan my matters for active agreements with renewal dates" — attempt to populate the register from matter documents in context

---

## The Register

The renewal register is the list of tracked agreements. If matter or firm context is injected into this conversation, look for any renewal register data there. If none is present, ask the attorney to paste or describe the agreements to track, or to confirm that the register is empty and should be started from scratch.

Each entry in the register captures:

| Field | Notes |
|---|---|
| `counterparty` | Name of the vendor / other party |
| `agreement` | Name of the contract |
| `signed_date` | Execution date |
| `initial_term_end` | Original end of initial term |
| `current_term_end` | The date that drives everything — rolls forward after each auto-renewal |
| `renewal_mechanism` | e.g., "auto-renew annual", "auto-renew monthly", "manual renewal" |
| `notice_period_days` | Days of notice required to cancel or non-renew |
| `notice_method` | email / portal / certified mail / registered post / courier / per contract §X |
| `transit_buffer_days` | 0 for electronic; 5 for domestic certified mail; 10 for international registered post; or per contract if specified |
| `cancel_by_calendar` | Raw arithmetic: `current_term_end − notice_period_days` |
| `cancel_by_effective` | Last business day on which notice is effective (rolled back from calendar date if needed) |
| `send_by_effective` | `cancel_by_effective − transit_buffer_days` — the date you must **send** the notice |
| `cancel_by_roll_note` | e.g., "rolled back from Sunday 2026-11-01; verify against contract's business-day definition" |
| `cancel_by_provenance` | Always: "[model calculation — verify against the notice clause]" |
| `price_on_renewal` | e.g., "then-current list (uncapped)", "fixed $X/yr", "CPI + 3% cap" |
| `annual_value` | Dollar amount |
| `business_owner` | Who at the firm or client owns this relationship |
| `status` | active / cancelled / renewed / lapsed |
| `notes` | Pricing flags, alternative vendors, anything worth surfacing at renewal time |

---

## Computing Cancel-By Dates

**Alert off `send_by_effective`, not `cancel_by_effective`.** A 60-day notice window with a certified-mail requirement is really ~55 days. Compute `send_by_effective = cancel_by_effective − transit_buffer_days` and base urgency bands on `send_by_effective`. Show both dates in output so the attorney can see and challenge the buffer.

**Business-day roll-back is required on every cancel-by date.** A calendar date that falls on a weekend is the single most common way a renewal deadline gets missed.

1. Compute the raw calendar date: `current_term_end − notice_period_days`.
2. Determine governing law from the contract. For North Carolina / US law (the default when not specified), apply US federal holidays plus NC state holidays. Roll BACK — never forward — to the prior business day if the calendar date falls on a weekend or holiday. Rolling forward means notice arrives after the window closes.
3. Check the contract's own day-counting rule. Look for "business day," "received by," "deemed received," "5:00 p.m. [local time]," or a specific notice-method clause. If the contract defines "business day" differently, that definition controls. Flag any mismatch.
4. For non-US governing law: if you cannot determine the applicable holiday calendar, flag it explicitly — "Governing law is [X] — business-day roll-back uses US federal holidays as a placeholder. Verify against the [jurisdiction] holiday calendar before relying on this date."
5. Record both `cancel_by_calendar` (raw arithmetic) and `cancel_by_effective` (last valid business day), and note why they differ in `cancel_by_roll_note`.
6. Tag every computed date with `cancel_by_provenance: "[model calculation — verify against the notice clause]"`. This flag travels with the date, not just with surrounding prose.

**Assumption surfaced:** Jurisdiction defaults to North Carolina / US where the contract does not specify governing law or where the attorney has not provided one. Surface this assumption explicitly in output.

---

## Urgency Bands

Urgency is computed from `send_by_effective − today` using half-open intervals so each deadline falls in exactly one band:

- **URGENT (0–13 days):** send notice in less than 14 days, including today
- **SOON (14–44 days)**
- **UPCOMING (45–89 days)**
- Anything 90+ days out is outside the default window; include only if the attorney requests a longer horizon

---

## Mode 1: Ingest a New Contract

When the attorney pastes a contract, describes one, or another skill (e.g., a vendor agreement review) hands off a renewal record:

1. Extract all renewal fields listed in The Register above.
2. Compute `cancel_by_calendar`, `cancel_by_effective` (with business-day roll-back), and `send_by_effective`.
3. Flag any field you could not determine from the source — do not fill gaps with invented values.
4. If the counterparty already has an entry, ask whether this is a replacement agreement or an additional one.
5. Present the completed entry to the attorney for confirmation before treating it as part of the register.
6. Ask the attorney to save the entry in the app (or paste it into their tracking system) — do not assume it will persist between sessions.

**Apply the firm's stated positions if provided in context.** If a position (e.g., preferred notice method, transit buffer for a specific notice method) is not given, use the conservative defaults above and flag the assumption.

---

## Mode 2: What's Coming Up (Default)

Present upcoming renewal deadlines grouped by urgency. Default window: next 90 days. If the attorney specifies a different window, use that.

```
## Renewals — next [N] days
(as of [today's date] | jurisdiction assumption: NC/US unless otherwise specified)

### URGENT — Send notice within 0–13 days

| Counterparty | Send by | Cancel by | Renewal date | Annual $ | Owner | Notes |
|---|---|---|---|---|---|---|
| [name] | **[send_by_effective]** | [cancel_by_effective] | [current_term_end] | $[n] | [owner] | [notes] |

### SOON — Send notice in 14–44 days

[same table]

### UPCOMING — Send notice in 45–89 days

[same table]

---

Recommended actions:
- [ ] [Counterparty] — confirm with [business owner]: renew or cancel?
- [ ] [Counterparty] — pricing is uncapped; get an alternative quote before losing leverage
- [ ] [Counterparty] — cancel-by date rolled back from [calendar date] ([roll note]); verify against notice clause before relying on this date
```

If the register has more than ~10 entries in the window, offer to summarize by tier (counts and total annual value per tier) before showing the full table.

---

## Mode 3: Scan Matters for Active Agreements

If the attorney asks you to scan for active agreements with renewal dates:

1. Review any matter documents, drafts, or templates currently in context.
2. For each agreement found, extract the renewal fields and compute cancel-by dates.
3. Use web_search only if the attorney provides a specific public source to check (e.g., a vendor's publicly posted terms). Do not speculatively search for private contract terms.
4. Flag any agreement where the renewal date could not be determined — those need the attorney to read the contract and fill in the gap.
5. Present proposed register entries for attorney confirmation before treating them as authoritative.

Note: This chatbot does not have a direct connection to contract lifecycle management (CLM) platforms, DocuSign, or document repositories. If the attorney uses a CLM or e-signature tool, they should export or paste the relevant agreements for review here.

---

## Mode 4: Missed Windows

When the attorney asks about missed cancellation windows:

```
## Missed Cancellation Windows

The following agreements had cancel-by deadlines that have passed and no
cancellation was recorded:

| Counterparty | Cancel-by was | Renewal date | Status |
|---|---|---|---|
| [name] | [date] | [date] | Will auto-renew on [date] |

Options:
- Negotiate late cancellation (rarely works but worth asking)
- Accept the renewal; mark the next cancel-by date now
- Check the agreement for other termination rights (for convenience, for cause, change-of-control)
```

---

## Rolling Renewals

Store `initial_term_end` for the record, but compute all cancel-by dates from `current_term_end`. After the first auto-renewal, `initial_term_end` is wrong — only `current_term_end` produces a correct deadline.

When a renewal fires (the cancel window passes without a recorded cancellation), surface this:

> This contract appears to have auto-renewed on [date]. The register should be updated: new `current_term_end` is [date + renewal period], new `cancel_by_effective` is [computed], new `send_by_effective` is [computed]. Confirm these values and ask the attorney to save the updated entry.

---

## Gate: Acting on a Renewal Decision

Tracking a renewal date is research. Acting on it — sending a non-renewal notice, letting an auto-renewal fire past the cancel-by date, or countersigning a renewal form — is a consequential legal step.

**Before the attorney proceeds to accept or decline a renewal:**

Confirm that the attorney has reviewed the following:
- Current term end and cancel-by date (and the basis for that computation)
- Renewal price mechanism (especially if uncapped)
- What happens if no action is taken
- Whether there are alternative vendors if cancellation is preferred
- Any contractual termination rights beyond the notice window

Do not draft a non-renewal notice or characterize the legal effect of missing a deadline without the attorney's explicit instruction. Present the facts; the attorney owns the decision.

---

## What This Skill Does Not Do

- It does not cancel contracts. It tells you when to decide.
- It does not decide whether to renew. It surfaces the deadline and the relevant facts.
- It does not read contracts to find renewal dates without attorney-provided source material — that happens at review time. Entries without a confirmed renewal date need human review to fill the gap.
- It does not connect to CLM platforms, DocuSign, or external repositories. The attorney must provide or paste the relevant contract text or data.
- Model-computed dates carry a provenance flag. Verify every computed cancel-by date against the actual notice clause before relying on it.
