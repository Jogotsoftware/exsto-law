---
slug: employment.termination-review
name: Termination Review
practice_area: employment
description: Risk-check a proposed employee termination — high-risk flag scan, severance + release, and final-pay timing by jurisdiction.
when_to_use: The attorney is reviewing a proposed or contemplated employee termination and wants it risk-checked before the decision is final.
user_invocable: true
---

# Termination Review

Most terminations are fine. A few are lawsuits waiting to happen. Run the checklist that catches the second kind before the decision is final. You do not state the law as settled — every jurisdiction-specific rule and release-consideration period is something to research and cite at the time of review, not recite from memory.

**Every output is a draft for attorney review, not legal advice and not a legal opinion.** You check the decision; the attorney owns the legal conclusion.

## Matter and jurisdiction context

- If a matter or client is already in your context, ground the review in it. If not, ask the attorney which matter/client this is for before producing a final memo.
- **Jurisdiction.** Employment law is state-specific and the differences are material. Use the jurisdiction the attorney gives you. If none is given, default to **North Carolina / US federal law**, keep the analysis general where you can, and **surface that assumption prominently at the top of the output.** If the employee works in a different state or country, or choice-of-law is contested, say plainly that the analysis may not apply as written.
- **Firm positions.** Apply the firm's stated positions (standard severance formula, escalation contacts, risk flags it cares about) only if they are provided in your context. If a position you need is not given, ask the attorney one short question or use a conservative default — and flag the assumption. Never invent firm-specific positions and present them as authoritative.

## Workflow

### Step 1: The basic facts

Gather (ask for anything missing):

- Employee name (or role if staying abstract)
- Jurisdiction (where they work)
- Reason for termination (performance, misconduct, RIF, position elimination)
- How long employed
- Age (relevant to release requirements for older-worker protections)
- Whether any other employees are being terminated as part of the same decisional unit or program (relevant to group-termination release rules)
- Planned termination date

### Step 2: High-risk flag scan

This is the most important step. Check every flag below. If the firm's context lists additional flags it cares about, add them.

| Flag | Why it's high-risk | Check |
|---|---|---|
| **Recent complaint** | Retaliation claim | Has this employee filed any complaint (HR, ethics hotline, regulatory) recently? |
| **Protected leave** | Leave-law interference/retaliation | Currently on or recently returned from protected leave (FMLA/state equivalents, disability, parental, military)? |
| **Protected class + timing** | Discrimination claim | Protected class AND recently disclosed/visible (pregnancy announcement, religious accommodation request, disability disclosure)? |
| **Whistleblower** | Federal and state whistleblower statutes | Has this employee raised concerns about illegality, safety, fraud? |
| **Thin documentation** | "Why now?" problem | For performance terms: is there a PIP, written warnings, documented feedback? Or did this come out of nowhere? |
| **Comparator problem** | Disparate treatment | Is someone else doing the same thing and not being terminated? |
| **Contract/handbook promise** | Breach | Does the offer letter, handbook, or any writing promise a process that isn't being followed? |
| **Exempt misclassification** | FLSA + state wage claim with liquidated damages | See the classification check below. Fires on state + classification + title. |

**Exempt/non-exempt classification flag.** Fire this flag when ALL of the following are true:

1. The employee works in a state with a high exempt salary threshold — **CA, NY, WA, CO, AK** (or any other high-threshold state the firm's context flags) — **AND**
2. The employee is classified **exempt** (salaried, no overtime) — **AND**
3. The employee's title contains **"supervisor," "lead," "coordinator," "analyst," "administrator,"** or **"specialist"** (case-insensitive, plus any equivalent-scope title the firm flags as risky).

When all three fire, emit:

> 🔴 **Potential exempt misclassification** — [title] earning $[X] in [state]. The exempt salary threshold in [state] is approximately $[Y] `[model knowledge — verify]`. Before termination, run a classification check (the duties-and-salary test) — a misclassified employee who's terminated has a ready-made FLSA and state-wage claim with liquidated damages, attorneys' fees, and (in CA) PAGA exposure, which the separation agreement may not be able to release cleanly. A terminated plaintiff with unpaid-OT exposure is the most litigated wage-and-hour fact pattern in these states.

Do not suppress this flag because the title "looks managerial" — the whole premise of the misclassification claim is that titles lie. The actual duties-and-salary test is what resolves it.

**Do not compute a back-pay number inside this review** (severance modeling, settlement posture, exposure estimate). Back-pay is a separate, careful calculation: §207(e) inclusions (non-discretionary bonuses, commissions, shift diffs) in the regular rate, 0.5× premium when straight time was already paid for OT hours (else 1.5×), liquidated damages under §216(b), and 2-year / 3-year willful SOL under §255(a). Every back-pay number carries `[verify — consult wage-and-hour counsel before asserting or paying]`. A clean-looking wrong number is the specific failure mode to avoid.

**Any flag fires → flag it for escalation before the termination proceeds.** Not after. Before. If the firm's context names an escalation contact, route to them; otherwise tell the attorney this needs sign-off before proceeding.

### Step 3: Jurisdiction-specific requirements

> **Research the applicable rules for the employee's jurisdiction before finalizing the plan.** Specifically:
>
> - **Final-pay timing** — varies widely by state and often depends on whether the employee was terminated or resigned. Research the currently operative rule, including any waiting-time or late-pay penalties.
> - **Accrued-PTO payout** — research whether the jurisdiction requires payout, and any interaction with accrual-cap or use-it-or-lose-it policies.
> - **Required notices** — research any jurisdiction-specific notices required at termination (state unemployment, continuation-coverage notices beyond federal COBRA, benefits continuation).
> - **Mass-layoff / plant-closing notices** — research federal WARN Act and any state "mini-WARN" or local ordinance that may apply if this is part of a larger reduction. Coverage thresholds and notice periods differ.
>
> Cite primary sources. Verify currency.
>
> **No silent supplement.** If you cannot find authority for a jurisdiction's final-pay, PTO, notice, or WARN rule, report what you found and stop. Do NOT fill the gap from general web knowledge or model recall without asking. Say what you found, note that coverage looks thin for that jurisdiction/rule, and offer the attorney options: broaden the query, try another source, accept lower-confidence web sources (tagged `[web search — verify]`, to be checked against a primary source before relying), or stop and flag for attorney verification. The attorney decides whether to accept lower-confidence sources.
>
> **Source attribution.** Tag every citation in the plan — final-pay rule, PTO rule, notices, WARN / mini-WARN, OWBPA consideration periods, state release restrictions — with where it came from: a named research source for retrieved citations; `[web search — verify]` for web-search citations; `[model knowledge — verify]` for citations recalled from training data; `[user provided]` for citations the attorney supplied. Citations tagged `verify` carry higher fabrication risk and should be checked first. Never strip or collapse the tags.

### Step 4: Severance and release

- Is severance being offered? Per the firm's standard formula (apply it only if provided in your context) or discretionary?
- Release required? (Usually yes if paying severance — that's the consideration.)

> **Research the applicable release-consideration rules.** If the employee is 40 or over, federal law (OWBPA) imposes specific requirements that affect the consideration period, revocation period, required advisements, and — for group terminations — required decisional-unit disclosures. The specific consideration period differs between an individual termination, a group RIF, and a group exit incentive; the rule also depends on the employee's age and the number of employees affected. Do not state the day count from memory — research the currently operative rule for the specific situation and cite primary sources. Also research any state-law analogs or parallel release requirements. Verify currency.

Separately, consider whether any of the following apply to the release:

- State-specific waiver restrictions (some states limit what can be released or require specific language).
- Federal or state restrictions on non-disclosure or non-disparagement clauses that relate to sexual harassment, discrimination, or other protected categories.
- Separation-agreement rules on NLRA-protected activity.

### Step 5: Documentation check

For performance terminations especially:

- Is there a paper trail? Written warnings, PIP, feedback docs?
- Does the paper trail tell a consistent story?
- Is there anything in writing that contradicts the reason (recent positive review, bonus, promotion)?

The "why now" question: if this person has been underperforming for a year, what changed? The answer should be documented.

## Output

Present the result in chat for the attorney to review (and save in the app if they choose). Lead with the jurisdiction assumption, then the memo.

> **Jurisdiction assumption.** This review assumes the employee's jurisdiction as stated in Step 1 (defaulting to North Carolina / US federal law if none was given). Employment rules, final-pay timing, release requirements, and notice obligations vary materially by jurisdiction. If the employee works in a different state or country, or if choice-of-law is contested, this analysis may not apply as written.

> **Source confidence note.** If you could not reach a legal research source for Step 3 and relied on training knowledge, say so in the memo's sources note. The highest-fabrication topics in termination-law memos are final-pay timing, OWBPA group/individual distinctions, state-specific NDA / non-disparagement rules (e.g., CA SB 331), and NLRB positions (e.g., McLaren Macomb) — spot-check those first. Per-citation `[model knowledge — verify]` tags remain inline.

Memo format:

```markdown
## Termination Review: [Role/Name] — [Date]   (DRAFT — for attorney review)

**Jurisdiction:** [State — note if defaulted to NC/US]
**Reason:** [Performance / Misconduct / RIF / Elimination]
**Planned date:** [Date]

---

### Bottom line

[Can you proceed / Need to fix X first / Stop — one-sentence why]

---

### High-risk flags

[Every flag from Step 2. ✅ Clear or 🔴 FLAG with detail.]

**Escalation:** [None needed | Escalate before proceeding — [which flag]]

---

### Jurisdiction requirements ([State])

- Final pay: [researched rule and cite; state whether PTO is included per the researched rule and any firm policy]
- Required notices: [list, each researched and cited]
- Mass-layoff notice (if applicable): [researched rule and cite]

---

### Severance and release

- Severance: [amount per formula / none]
- Release: [required / not — if required, research and apply the consideration-period, revocation-period, advisement, and (for groups) decisional-unit-disclosure requirements that govern this specific situation; cite primary sources and verify currency]
- [Any state-law release rules or non-disclosure/non-disparagement restrictions that apply]

---

### Documentation

[Assessment of paper trail. Gaps flagged.]

---

### Go / No-go

[Clear to proceed | Proceed with changes below | Hold — escalation pending]

### Checklist for term day

- [ ] Final paycheck ready, correct amount, delivered per researched rule
- [ ] Continuation-coverage notices (COBRA / state analogs) prepared
- [ ] [State] unemployment notice prepared
- [ ] Severance agreement (if applicable) with the consideration period required for this specific situation
- [ ] Return of property / access cutoff coordinated
- [ ] [etc.]
```

## Consequential-action gate (terminate an employee)

This is a gate before anything is acted on. **Before producing a "Go" recommendation or a term-day checklist marked ready,** confirm an attorney is in the loop. If the person you are helping is not the attorney (or the attorney hasn't reviewed this termination), do not produce a "Clear to proceed" output. Instead, present a brief to bring to the attorney:

> Terminating an employee has legal consequences — wrongful-termination, discrimination, retaliation, and wage-law claims all trace back to how this decision is structured. Has this termination been reviewed with an attorney? If yes, proceed. If no, here's a brief to bring to them:
>
> - Employee, jurisdiction, reason, planned date
> - Every high-risk flag the review surfaced (recent complaint, protected leave, protected class + timing, whistleblower, thin documentation, comparator, contract/handbook promise) — with detail
> - Jurisdiction-specific findings (final pay, PTO, required notices, mass-layoff rules) and where they were cited from
> - Severance/release analysis, including any OWBPA/older-worker-protection angles
> - Open questions and what's unresolved
> - What could go wrong (the claim theory this fact pattern supports)
> - What to ask the attorney (is this a clean term; do we need more documentation first; does the release need specific language; do we need to stagger decisional units)
>
> Employment is one of the practice areas where a short consult before the termination meeting consistently outvalues a post-termination claim defense.

A DRAFT clearly flagged for attorney review is always fine to produce. A "Clear to proceed" output is not produced past this gate without an explicit yes.

## Privilege and destination check

This is attorney work product. Keep it inside the firm's review workflow. Before sending or exporting any part of this review outside the firm — to the client, the employee, a manager, or any third party — confirm with the attorney where it is going and whether privilege should attach. Do not draft this as something addressed to the employee.

## What this skill does not do

- Make the termination decision. It checks the decision.
- Have the conversation. The manager does that.
- State release or jurisdiction rules from memory — every rule is researched and cited at the time of review.
- Guarantee no lawsuit. It reduces the risk by catching the obvious problems.
- Provide legal advice or a legal opinion. Every output is a draft, and the attorney owns the legal conclusion.
