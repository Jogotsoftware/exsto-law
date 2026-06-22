---
slug: privacy.dpa-review
name: Data Processing Agreement Review
practice_area: privacy
description: Review a Data Processing Agreement term-by-term, auto-detecting whether the firm is processor or controller and flagging gaps, redlines, and regulatory floor issues.
when_to_use: When the attorney says "review this DPA," "check this data processing addendum," "customer sent their DPA," "is this DPA okay," or pastes or attaches a DPA or data processing addendum for review.
user_invocable: true
---

# Data Processing Agreement Review

## Getting started

Ask the attorney to paste or share the DPA text (or the key clauses). If a matter or client is in context, ground the review in it; otherwise ask which matter or counterparty this is for.

Establish **direction** before anything else — every analysis below depends on it:

- **We are the processor** → the customer sent us their DPA → apply the defensive (processor-side) review.
- **We are the controller** → we are sending a DPA to a vendor, or reviewing a vendor's DPA → apply the protective (controller-side) review.

If unclear, ask one short question before proceeding. Getting direction wrong inverts every recommendation.

> **Every output you produce is a draft for attorney review. It is not legal advice and not a legal opinion. The attorney owns the legal conclusion.**

---

## Jurisdiction assumption

Default to **North Carolina / United States** unless the counterparty, data subjects, or the DPA itself signals otherwise. Explicitly state the jurisdiction assumption at the top of every review. Privacy rules, response deadlines, lawful bases, and transfer mechanisms vary materially by jurisdiction (GDPR vs. US state consumer privacy laws vs. sectoral federal regimes). If a non-US party is involved, surface the applicable regime and flag where the analysis may differ.

---

## Check for prior context on this counterparty or processing activity

Before reviewing, check whether any prior triage, privacy impact assessment, or DPA review for this counterparty or processing activity is available in context (e.g., prior chat summaries the attorney provides or documents in the matter). If found, cite the prior finding and carry its severity rating as a floor — a processing activity previously rated 🔴 cannot be quietly downgraded to 🟢 without stating and explaining the change. If no prior work is found, note that explicitly so the attorney knows the check ran.

---

## Federal sectoral overlay (answer this before the term-by-term walk)

Before walking the DPA clause by clause, answer: **does the data flowing through this DPA include any federally-regulated category?** GDPR-completeness and state consumer privacy law compliance are a floor; federal sectoral law often supplies a separate, controlling layer. A DPA that is GDPR-complete can still be GLBA-blind, HIPAA-blind, or COPPA-blind.

Ask the attorney (or surface the question if it cannot be answered from context):

> Does this processing touch:
>
> - **Financial account data or nonpublic personal information about consumers** (GLBA / Reg P)? If yes, the DPA needs: an NPI-sharing restriction consistent with 15 U.S.C. § 6802(a)–(c) and Reg P, safeguards language aligned with the Safeguards Rule (16 C.F.R. Part 314), incident notification timelines aligned with applicable FTC/OCC requirements, and a clean carve-out so a CCPA § 1798.145(e) exemption does not inadvertently waive GLBA-level obligations.
> - **Protected health information held by a covered entity or business associate** (HIPAA Privacy / Security Rules)? If yes, the DPA must include or be layered with a Business Associate Agreement (BAA) per 45 C.F.R. § 164.504(e), breach notification timing aligned with HITECH (60 days to covered entity; 60 days to HHS for 500+ breaches; media notification for 500+ in a state), permitted-uses clause, and subcontractor BAA flow-down. A commercial DPA without BAA flow-down for PHI is a defect.
> - **Education records held by or on behalf of a school** (FERPA)? If yes, the DPA needs a "school official" / directory-information framing consistent with 34 C.F.R. § 99.31, parental-consent flow-through, and applicable state student-privacy analog handling (e.g., NY Ed Law 2-d, CA SOPIPA, IL SOPPA).
> - **Data from children under 13 collected by an operator of an online service directed to children or with actual knowledge of age** (COPPA)? If yes, the DPA needs verifiable parental consent flow-through, retention limits, deletion-on-request machinery, and prohibition on behavioral advertising absent VPC.
> - **Other sectoral regimes** (VPPA for video-viewing records, CPNI for carrier data, DPPA for DMV records, TCPA for call/SMS, GLBA Reg S-P for broker-dealers, FTC Act § 5 for sensitive data)?
>
> If yes to any: the federal overlay usually supplies the controlling substantive restriction, not just an exemption from a state privacy law. Use web_search to research the currently operative provision and cite it.

If no sectoral overlay applies, note it explicitly — "no federally-regulated data categories identified; sectoral overlay n/a" — so the attorney sees the check happened.

---

## Firm playbook positions

Apply any playbook positions the attorney provides in context (e.g., standard positions on breach notice windows, audit rights, subprocessor approval). If a position is not provided, either ask the attorney one short question or use a conservative default and **explicitly flag the assumption** so the attorney can correct it. Never invent firm-specific positions as authoritative.

---

## The term-by-term review

### Core terms (check every DPA)

Walk the DPA through these terms. Where research is needed on regulatory floors, use **web_search** and tag results `[web search — verify]` — the attorney should verify against a primary source before relying on them.

**Source attribution tiers for citations:**

- `[settled]` — stable statutory or regulatory references unlikely to have changed (e.g., GDPR Art. 28, Art. 33 72-hour breach notice). Still verify before relying, but lower priority.
- `[verify]` — real but should be verified: specific implementing regulations, regulator guidance, adequacy decisions, SCC modules, UK Addendum/IDTA status, thresholds, effective dates.
- `[verify-pinpoint]` — pinpoint citations (specific subsection letters, clause numbers within SCCs, paragraph numbers) carry the highest fabrication risk and must always be verified against a primary source.
- `[web search — verify]` — retrieved via web_search; check against a primary source before relying.

| Term | Looking for | Common fights |
|---|---|---|
| **Roles** | Clear controller/processor designation; matches operational reality | Counterparty labels the relationship (e.g., "joint controller") in a way that does not match reality |
| **Processing scope** | Limited to documented instructions; defined purposes | Open-ended scope expanders ("and related purposes") |
| **Subprocessors** | Current list disclosed, change mechanism defined | Blanket approval vs. veto vs. notice-only |
| **Security measures** | Annex references specific controls or standards | "Appropriate technical and organizational measures" with no annex = empty promise |
| **Breach notification** | Defined trigger ("discovery" vs. "confirmation"), defined timeline | Timeline tightness; clock trigger; "without undue delay" is vague |
| **Audit rights** | Method (report vs. on-site), frequency, notice, cost allocation | On-site audits on tight notice |
| **International transfers** | Transfer mechanism identified, supplementary measures, transfer impact assessment reference | Outdated or missing transfer mechanisms |
| **Deletion/return** | Timeline post-termination, certification, backup carveout | "Commercially reasonable" deletion = undefined |
| **Liability** | Within MSA cap or separate; carveouts for data breach | Uncapped data breach liability |

---

### When we are the processor: defensive review

Customer DPAs push operational burden onto us. For each clause, compare the customer's ask to the firm's playbook. Where the ask exceeds the playbook, push back to the firm's standard position (if provided) or flag for attorney decision.

| Clause | Risk | How to handle |
|---|---|---|
| Subprocessor approval right (veto) | Cannot add infrastructure without customer-by-customer approval | Apply firm's playbook position on subprocessor changes, or ask attorney |
| On-site audit on short notice | Unworkable at scale | Apply firm's playbook position on audit rights |
| Aggressive breach notification window | Often demands notice before we know what happened | Use web_search to research the regulatory floor for each applicable regime; cite results `[web search — verify]`; flag if customer's window is tighter than required |
| Hard data residency (single country or data center) | May not match architecture | Confirm with attorney what we can actually commit to |
| Processor liability uncapped | Bet-the-company exposure | Flag; apply firm's playbook position on liability cap |
| Customer may issue binding "instructions" | Open-ended operational control | Define "instructions" as documented in the agreement or agreed in writing |
| Deletion on very short timeline | Backup and log retention makes this impossible | Flag backup rotation carveout; apply firm's playbook position on deletion timeline |

---

### When we are the controller: protective review

Vendor DPAs often give us minimal protection. For each clause, compare to the controller-side playbook.

| Clause | Gap | How to handle |
|---|---|---|
| No subprocessor list | Don't know who touches our data | Require published current list + advance notice per playbook |
| "Industry standard security" only | Means nothing enforceable | Require annex with specific controls, or reference a named standard (e.g., SOC 2, ISO 27001) |
| No breach notification timeline | Vendor tells us whenever it suits them | Use web_search to research applicable regulatory floor; require timeline aligned with playbook |
| No audit rights at all | Cannot verify anything | Require at minimum an independent audit report |
| Vendor can use data for "service improvement" | Potential training on our data | Strike; processing limited to providing the service to us |
| No international transfer mechanism | No lawful basis for transfer | Research the currently operative transfer mechanism for the applicable corridor via web_search; flag missing mechanism as 🔴 — there is no lawful transfer |
| No deletion commitment | Data lives forever | Require playbook position on deletion + certification on request |

---

## Consistency check: privacy policy

The DPA cannot promise something the firm's privacy policy (or the client's) does not cover, and vice versa. Check:

- If the DPA limits processing to purposes X, Y, Z — does the applicable privacy policy list those purposes?
- If the privacy policy says "we never sell data" — does any DPA clause look like a sale under CCPA?
- If the privacy policy names specific subprocessor categories — does the DPA subprocessor list match?

Flag mismatches. Usually the privacy policy is stale rather than the DPA being wrong, but one of them needs to be fixed.

---

## Redline granularity

**Edit at the smallest possible granularity.** A redline is a negotiation artifact, not a rewrite.

Default to the smallest edit that achieves the playbook position:

- Replace a **word** before a phrase.
- Replace a **phrase** before a sentence.
- Restructure a **subclause** before replacing the sentence.
- Replace a **sentence** before replacing a clause.
- Only replace a **whole clause** when the counterparty's version is so far from your position that surgical edits would be harder to read — and if you do, say so: "We've replaced §[X] rather than marking it up because the changes were extensive."

When in doubt, smaller. Surgical redlines signal careful reading; wholesale replacements signal otherwise.

---

## International transfers

If the DPA contemplates cross-border data transfers, use web_search to research the currently operative transfer mechanism for each applicable corridor. For each origin/destination pair, identify: the applicable regime, whether any adequacy decision is in force, which transfer mechanism is required or available (e.g., Standard Contractual Clauses and applicable module, UK Addendum or IDTA, BCRs, derogations), whether a transfer impact assessment is required, and what supplementary measures may be needed. Tag results `[web search — verify]` and flag all conclusions for attorney verification before relying on them.

If a transfer mechanism is missing and an international transfer is present, that is a 🔴 — there is no lawful transfer basis.

Note: adequacy decisions, SCC versions, and supplementary-measure requirements change through new Commission decisions, court rulings, and regulator guidance. Always verify currency.

---

## Output format

Present the review in chat for the attorney to read and save in the app if they choose.

```
# DPA Review: [Counterparty]

**Direction:** [We are processor / We are controller]
**Reviewed:** [date]
**Jurisdiction assumption:** [e.g., North Carolina / US — no GDPR trigger identified]
**Prior context:** [Prior triage/PIA/DPA review found / Not found]
**Federal sectoral overlay:** [Applicable regime(s) / None identified]
**Attached to:** [MSA / standalone]

---

## Bottom line

[Two sentences. Can we sign? What has to change?]

**Issues:** [N]🟢 [N]🟡 [N]🟠 [N]🔴

---

## Term-by-term

[For each core term: what the counterparty's DPA says → what the playbook
or regulatory floor requires → the gap → the risk rating → proposed redline
language. Keep each term to a short self-contained block.]

---

## Privacy policy consistency

[🟢 Consistent | 🟡 Flags: list mismatches]

---

## Recommended redlines

[Consolidated surgical redlines, ready to present to counterparty]

---

## If they won't move

[For each flagged issue: fallback position (from firm playbook if provided,
or conservative default flagged as an assumption), or escalation note if
no fallback exists]

---

## Next steps

[Decision tree — options: (a) return redlines to counterparty, (b) escalate
to attorney for sign-off before proceeding, (c) gather more facts (list what),
(d) accept with documented risk, (e) decline / walk away, (f) something else.
Attorney picks.]
```

> **Reminder:** This review is a draft for attorney review. It is not legal advice and not a legal opinion. The attorney owns the legal conclusion before anything is sent, executed, or relied upon.

---

## Gate: before signing or countersigning a DPA

Reviewing a DPA is research. *Signing* it — or instructing someone to countersign, consenting to automatic execution on a counterparty platform, or returning an executed version — is the consequential legal act. Do not proceed past this gate without explicit confirmation from the attorney that they have reviewed the output and are ready to execute.

---

## What this skill does not do

- It does not draft a DPA from scratch. If a template is needed, ask the attorney to provide one or check the firm's document templates in the app.
- It does not perform the Transfer Impact Assessment itself — it flags when one is required and what it needs to cover.
- It does not decide whether to accept terms outside the firm's fallbacks — it routes those decisions to the attorney with a clear framing of the tradeoffs.
- It does not access external legal research databases (Westlaw, CoCounsel, etc.) — it uses web_search for regulatory floor research and tags results `[web search — verify]` accordingly.
