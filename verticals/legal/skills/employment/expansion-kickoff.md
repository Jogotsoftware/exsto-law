---
slug: employment.expansion-kickoff
name: International Expansion Kickoff
practice_area: employment
description: Structure an international hiring expansion — run the Employer of Record vs. entity framing, draft cross-functional questions for tax/finance/HR, produce a structured outside-counsel briefing request, and surface country-specific risk flags.
when_to_use: Attorney says "we're hiring in [country]," "expansion to [country]," "first hire in [country]," "EOR vs. entity," or asks how to structure an international employment engagement.
user_invocable: true
---

## Purpose

International hiring gets handled poorly because nobody owns the full picture. Legal knows the employment-law questions but not the permanent establishment risk questions. Finance knows the cost model but not the employee-representation triggers. HR knows the comp benchmarks but not the Day 1 compliance requirements.

This skill maps the terrain, drafts the right questions for each stakeholder, produces a structured outside-counsel briefing request, and surfaces the open items that need to close before the first hire starts.

**This skill assumes expansion is decided.** It is not a "should we expand?" framework.

**This skill does not contain country-specific employment law.** Substantive rules change frequently and vary by role, headcount, and industry. Every country is routed through an outside-counsel briefing — the skill does not rely on a stored reference table.

If a matter or client is in context, ground all work in that matter. If no matter is in context, ask: "Which matter or client is this for?"

**Jurisdiction assumption:** This skill defaults to US-parent, cross-border expansion analysis. Surface this assumption explicitly and flag it in the output. North Carolina / US law governs the domestic entity; local law of the target country is exactly what outside counsel must advise on.

> Every output produced by this skill is a draft for attorney review. It is not legal advice and does not constitute a legal opinion. The attorney owns every legal conclusion.

---

## Step 1 — Information gathering

Ask all of the following in a single block. Do not proceed until you have responses — gaps in the answers are themselves useful data.

> Before I build the expansion plan I need to understand the shape of this expansion. Please answer what you can:
>
> **The expansion**
> - Which country?
> - What roles are you hiring? (Job function matters — a sales rep closing deals creates different legal exposure than an engineer writing code.)
> - How many hires are planned in the next 12 months?
> - When does the first person need to start?
>
> **Current state**
> - Do you already have a legal entity in this country?
> - Have you used an Employer of Record (EOR) provider before? Are you already considering one?
> - Has tax or finance been looped in yet?
> - Do you have outside employment counsel in this country?
>
> **Strategic context**
> - Is this a long-term strategic commitment (building a real team) or testing the market (one or two hires, see how it goes)?
> - Who is the executive sponsor making the structure decision?

---

## Step 2 — EOR vs. entity framing

Do not make this decision. Frame it with enough precision that the CFO and tax counsel can make it.

Work through the following factors against the intake answers and produce a structured framing document:

**The core trade-off:**

| Factor | Points toward EOR | Points toward Entity |
|---|---|---|
| Headcount in 12 months | Fewer hires | More hires |
| Timeline to first hire | Short runway | Longer runway available |
| Strategic commitment | Testing the market | Long-term presence |
| Cost sensitivity | EOR markup acceptable | Scale makes entity more efficient |
| Control needs | Low — EOR employer handles local HR | High — want direct employer relationship |
| IP sensitivity | Lower | Higher — entity ownership cleaner |

Specific headcount break-even points, EOR markup ranges, setup costs, and timelines vary by country and provider — do not estimate them from memory. Route those questions to tax/finance and the EOR provider.

**PE risk flag (route to tax counsel immediately):**

If the roles include sales, business development, account management, or anyone with authority to negotiate or sign contracts on behalf of the company — flag this explicitly:

> **PE Risk:** [Role type] may create a taxable permanent establishment in [country] even before a legal entity exists. This is a tax question, not an employment question. Tax counsel must assess this before the first hire.

**Questions for the CFO and tax counsel:**

> - At [N] hires over 12 months, at what headcount does entity setup become more cost-effective than EOR (accounting for EOR markup, setup costs, and ongoing compliance burden)?
> - [If PE-risk roles:] Do these role types create a taxable permanent establishment in [country]? If yes, does that change the entity timeline?
> - If we start with EOR and convert to entity later, what are the transition risks for the employees already on EOR?
> - Who is our preferred EOR provider for this country, and have we vetted their local compliance track record?

---

## Step 3 — Cross-functional triggers

For each function that needs to be looped in, state what they need to do and draft the specific questions legal should ask them. Do not just say "loop in finance" — draft the ask.

**Tax counsel** (always required before first hire)

What they need to do: PE risk analysis, determine whether an entity is required for tax purposes, advise on equity tax treatment in this jurisdiction.

Questions legal should ask:
- Does hiring a [role type] in [country] create a permanent establishment or taxable nexus before we have an entity?
- What is our exposure window if we start hiring before the PE question is resolved?
- How are our equity awards (RSUs/options) taxed in [country]? Do we need local tax counsel to advise employees at grant and vesting?
- If we set up an entity, what intercompany services agreement is needed between the subsidiary and the US parent?

**Finance / Payroll** (required before first paycheck)

What they need to do: identify a local payroll provider (or confirm EOR handles it), budget mandatory employer contributions, set up local banking if using an entity.

Questions legal should ask:
- Have we identified a local payroll provider? (If EOR: confirm EOR handles payroll including local social contributions.)
- What are the mandatory employer contributions in [country] — pension, social insurance, healthcare — and are these budgeted in the comp model?
- How will equity grants be administered for employees in [country]? Has anyone modeled the employer-side tax withholding obligations at vesting?

**HR / Total Rewards** (required before an offer is made)

What they need to do: benefits and comp benchmarking against local market, confirm mandatory vs. supplemental benefits.

Questions legal should ask:
- What benefits are legally mandatory in [country] vs. market-standard? (Do not want to accidentally promise more than required or less than market.)
- Is our standard equity package competitive in this market, or does local practice differ significantly?
- Who will be this person's day-to-day manager — local or remote from HQ? (This affects employee-representation analysis and employment agreement terms in some jurisdictions.)

**Outside counsel** (always required — do not skip)

What they need to do: research and advise on the local employment framework for this role and headcount, review/draft the local employment agreement, flag any structural issues with the proposed arrangement.

Send the briefing request in Step 4 at the outset — do not ask outside counsel piecemeal.

---

## Step 4 — Outside-counsel briefing request

Draft the following briefing request, tailored to the intake answers. If the firm has designated outside counsel for this country (from matter context or attorney input), address it directly; otherwise flag that outside counsel must be selected before sending.

Use web_search to check for any recent, significant legal changes in the target country that are publicly known before drafting — note the search date and flag any findings the attorney should raise with outside counsel. Do not rely on your training data alone for current law.

---

**Outside Counsel Briefing Request — [Country]**

> We are planning to hire [N] employees in [Country] starting [date], in the following roles: [roles]. Target headcount over 12 months: [N]. Preferred structure (subject to your advice and tax counsel): [EOR / entity / undecided]. Please provide a briefing covering each of the following. Answer as questions with cites to primary law — we want to track changes over time.
>
> 1. **Entity and engagement structure** — what are our options (direct hire via entity, EOR, contractor), and what are the practical and legal trade-offs for this headcount and these roles?
>
> 2. **Employment contract requirements** — what form is required or standard? What must be included? What cannot be included or is unenforceable? What language or translation requirements apply?
>
> 3. **Termination** — what are the notice requirements and severance obligations? How difficult is termination in practice (protected-cause standards, social-selection rules in reductions in force, reasonable-notice exposure)? What documentation standard should we establish from day one?
>
> 4. **Mandatory benefits and employer contributions** — what must we provide by law (pension, social insurance, healthcare, paid leave, bonuses)? What are the current employer contribution rates we should budget? Please cite the controlling statute and verify currency.
>
> 5. **Restrictive covenants** — are non-competes enforceable? Under what conditions and with what compensation requirements? What confidentiality and IP assignment language holds up?
>
> 6. **Employee representation** — are there works council, employee representation, union, or collective bargaining requirements? At what headcount do they trigger? What consultation or co-determination rights apply? Are we covered by any sectoral collective agreement even if we are not unionized?
>
> 7. **Data protection** — what obligations apply to employee data? Is there a data transfer mechanism needed for employee data flowing to the US?
>
> 8. **Work authorization** — what permits or visas are required for foreign nationals? What are the processing timelines?
>
> 9. **Industry-specific rules** — are there sector rules, awards, or collective agreements that apply to our industry regardless of whether we are unionized?
>
> 10. **Contractor / independent-contractor risk** — what is the country's test for worker classification, and what are the deemed-employment or reclassification risks for any contractor arrangements we may consider?
>
> 11. **Equity / incentive compensation** — any local tax, securities, or employment-law rules that govern how we grant RSUs, options, or other equity here?
>
> 12. **Day 1 compliance** — what must be in place before the first employee starts? Registration requirements, notices, filings, posters?
>
> 13. **Top 2–3 things that surprise US companies hiring here for the first time** — what do you wish clients had asked you earlier? What has changed recently that a US team might not have caught?

---

## Step 5 — Open items summary

Present the following open-item table in chat for the attorney to review and save in the app if they choose. Generate one row per discrete action identified in Steps 2–4. Do not collapse multiple actions into one row — each item should be completable and attributable to a single owner.

| # | Category | Item | Owner | Status | Key Questions |
|---|---|---|---|---|---|
| 1 | Tax | PE risk analysis | Tax counsel | Open | [questions from Step 3] |
| 2 | Finance | Payroll and employer contributions | Finance | Open | [questions from Step 3] |
| 3 | HR | Benefits and comp benchmarking | HR / Total Rewards | Open | [questions from Step 3] |
| 4 | Outside Counsel | Country briefing | Outside Counsel | Open | [full agenda from Step 4] |
| ... | | | | | |

If the firm's stated positions or engagement preferences are provided in your context (e.g., preferred EOR providers, existing outside-counsel relationships, internal escalation contacts), apply them. If a position is not given, flag the gap and use a conservative default — do not invent firm positions.

---

## Step 6 — Final output

Present the full plan in chat with this structure:

```
## International Expansion: [Country] — [Date]

**First hire target:** [date]
**Headcount (12 months):** [N]
**Roles:** [list]
**Structure under consideration:** [EOR / entity / undecided]

---

### EOR vs. Entity

[Framing from Step 2 — table, PE risk flag if applicable, questions for CFO/tax]

---

### Who needs to be looped in — and what to ask them

**Tax counsel** — [N] questions
[Questions from Step 3]

**Finance / Payroll** — [N] questions
[Questions from Step 3]

**HR / Total Rewards** — [N] questions
[Questions from Step 3]

**Outside counsel** — see briefing request below
[Full briefing request from Step 4]

---

### Open items ([N] total)

[Table from Step 5]

---

> **Jurisdiction assumption.** This plan frames the expansion to the single country identified in intake. Local employment law, tax rules, employee-representation obligations, and data-protection requirements vary materially by country, region, industry, and headcount, and change frequently. Every substantive local-law answer comes from the outside-counsel briefing — not from this skill. If the plan is later adapted for another country, re-run this skill for that country.
>
> This output is a draft for attorney review. It is not legal advice and does not constitute a legal opinion. The attorney owns every legal conclusion.
```

---

## What this skill does NOT do

- Advise on specific local employment law — that is outside counsel's job.
- Make the EOR vs. entity decision — frames it for the right decision-makers.
- Draft the local employment agreement — flags that outside counsel must do this.
- State country-specific rules from its own training data as authoritative — every country is routed through an outside-counsel briefing.
- Substitute for outside counsel engagement — every new country requires local counsel, no exceptions.
- Access Westlaw, CourtListener, or other legal research databases — uses web_search and any documents the attorney provides, and notes the limits of that.
