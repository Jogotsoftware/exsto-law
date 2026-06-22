---
slug: ai-governance.ai-inventory
name: EU Artificial Intelligence Act System Inventory
practice_area: ai-governance
description: Build and maintain a per-system AI inventory under the EU AI Act, classifying each system by role (provider, deployer, importer, etc.) and risk tier (prohibited, high-risk, limited, minimal, General Purpose Artificial Intelligence).
when_to_use: When the attorney asks to add, list, classify, or review an AI system under the EU AI Act, says "AI inventory," "AI register," "classify this AI system," or asks what obligations apply to a specific system.
user_invocable: true
---

## Core principle

**Role and tier are per-system, not per-organization.** A single firm can be a *provider* of System A, a *deployer* of System B, and an *importer* of System C — each combination triggers a different set of EU AI Act obligations. The inventory exists to track those assessments so the attorney can find them. Obligation analysis happens in conversation, not from a table.

> **Every output here is a draft for attorney review, not legal advice or a legal opinion. The attorney owns the legal conclusion and must verify all article mappings against the current EU AI Act text, which is phasing in through 2027.**

## Which matter/client to work under

If a matter or client is already in context, ground your work in it. If not, ask the attorney: "Which client or matter should I associate this AI system with?" before proceeding.

## What to do when the attorney invokes this skill

Determine what the attorney wants:

- **"List" / "what systems do we have"** — show the inventory table (see **List format** below).
- **"Add" / "add an AI system"** — run the **Add flow**.
- **"Edit [system]"** — show the current record, ask what to change, update one field at a time, confirm before finalizing.
- **"Classify [system]"** — run the **Classification walk-through** on an existing system.
- **"Show [system]"** — display the full record for that system.
- **"What are my obligations for [system]"** — perform the obligation analysis in conversation (see **Why obligations are not derived from a table**).

Present results in chat for the attorney to review and save in the app.

## List format

Render as a compact table:

| ID | Name | Owner | Status | EU Nexus | Role | Tier | Next Review |
|----|------|-------|--------|----------|------|------|-------------|
| sys-001 | Resume screening | HR / Jamie | in_production | yes | deployer | high_risk | 2026-08-01 |
| sys-002 | Email drafting assistant | IT / Priya | in_production | no | deployer | limited | 2026-12-01 |

Under the table, show counts by tier and flag: "N systems due for review within 30 days."

After listing, offer: "Want to filter by status, tier, EU nexus, or owner? Or walk through obligations for any specific system?"

## Add flow

Ask one field at a time (or accept a paste of all fields at once). Required fields are **name, owner, description, status, eu_nexus**. Role and tier can be deferred — say so explicitly.

1. **Name.** Short label for the system.
2. **Owner.** Person or team accountable for it day-to-day.
3. **Description.** One to two sentences: what does it do, and against what data?
4. **Status.** One of: `planned | in_development | in_production | deprecated`.
5. **EU nexus.** Is the system (a) deployed in the EU/EEA, (b) offered to users in the EU/EEA, or (c) used to produce outputs that affect people in the EU/EEA? If any of these are true, EU AI Act analysis applies.
6. **Proceed to classification?** Offer to run the classification walk-through now, or defer: "You can come back and ask me to classify this system at any time."

Assign an ID using the next available integer in sequence (sys-001, sys-002, etc.).

After adding, say:
> Recorded. When you're ready to walk through obligations for this system, just ask — I'll do it in conversation and flag where the AI Act article mapping needs your verification. I don't derive obligations from a table because the mapping is complex and the Act is still phasing in.

## Classification walk-through

The walk-through produces `role`, `role_basis`, `tier`, and `tier_basis`. Both bases are tagged `[verify against current AI Act text]` — not because this is hedging, but because the article mapping is complex and the AI Act is phasing in through 2027. **The attorney owns verification.**

**Never classify silently.** The walk-through must be visible; do not auto-classify from a description.

### Step 1 — Determine the role

Ask: "Who does what to this system?"

Options, with the distinguishing test:

- **Provider** — the client develops it (or has it developed) and places it on the EU market or puts it into service under their own name or trademark.
- **Deployer** — the client uses it under their own authority for a professional purpose. Most common inside businesses.
- **Importer** — the client brings an AI system into the EU from a provider established outside the EU.
- **Distributor** — the client makes an AI system available on the EU market without being the provider or importer.
- **Authorized representative** — the client acts on behalf of a non-EU provider and is established in the EU.
- **Product manufacturer** — the client places a general-purpose AI system (or another AI system) into a product under their own name/trademark; treated as provider for that product.

**Dual-role flag.** If the client substantially modifies a vendor system — fine-tunes on their own data, changes the intended purpose, rebrands — they may become a **provider** of the modified system even if they started as a deployer. Call this out whenever the attorney describes any modification beyond configuration. `[verify against current AI Act text — Article 25, provider obligations and substantial modification]`

Write the role and a one-sentence `role_basis`.

### Step 2 — Determine the tier

Check in order:

#### A. Article 5 — Prohibited practices `[verify against current AI Act text — Article 5]`

Summaries (not definitive text):
- Subliminal or deceptive techniques materially distorting behavior
- Exploiting vulnerabilities (age, disability, socio-economic status) to materially distort behavior
- Social scoring by public authorities leading to detrimental treatment
- Real-time remote biometric identification in publicly accessible spaces for law enforcement (narrow exceptions apply)
- Biometric categorization inferring race, political opinions, union membership, religious/philosophical beliefs, sex life, or sexual orientation
- Emotion recognition in the workplace or education (medical and safety exceptions apply)
- Facial-image database scraping from the internet or CCTV
- Predictive policing based solely on personality traits

If matched: tier is `prohibited`. Flag the use case as a stop and advise routing to the client's governance team for a prohibited-practice workflow before any further deployment.

#### B. Annex III — High-risk areas `[verify against current AI Act text — Annex III]`

Summaries:
1. Biometric identification and categorization
2. Critical infrastructure (digital infrastructure, road traffic, supply of water/gas/heating/electricity)
3. Education and vocational training (access decisions, evaluation, proctoring, monitoring prohibited behavior)
4. Employment, worker management, self-employment access — recruitment, selection, promotion, termination, task allocation, monitoring, performance evaluation
5. Essential private and public services (public benefits, credit scoring for individuals, risk assessment and pricing for life/health insurance, emergency dispatch)
6. Law enforcement (risk assessment, polygraphs, deepfake detection, reliability of evidence, profiling)
7. Migration, asylum, border control (risk assessment, travel document verification, examination of applications)
8. Administration of justice and democratic processes (research and interpretation of law, influencing elections)

If matched: tier is `high_risk`. Note the Annex III area and subsection.

#### C. General Purpose Artificial Intelligence (GPAI) `[verify against current AI Act text — Article 51 and surrounding]`

- **GPAI:** model trained on broad data at scale, designed for generality, capable of competently performing a wide range of distinct tasks.
- **GPAI with systemic risk:** cumulative training compute exceeds 10^25 FLOPs, or designated by the European Commission.

#### D. Limited risk

Chatbots interacting with natural persons, deepfakes, emotion recognition and biometric categorization outside Article 5 scope — transparency obligations apply.

#### E. Minimal risk

Everything else.

Write the tier and a one-sentence `tier_basis` citing the article or Annex entry that matched, tagged `[verify against current AI Act text]`.

### Step 3 — Offer next steps

After classification, offer:
1. "Want me to walk through obligations for this system? I'll do it in conversation."
2. "Want to run a full impact assessment? I can draft the analysis in chat."
3. "Want to set a next review date?"

## Full record format (for reference)

When displaying a full record, present these fields:

```
ID:                   sys-001
Name:                 Resume screening tool
Owner:                HR / Jamie
Description:          Filters inbound CVs against job criteria
Status:               in_production
EU nexus:             yes
Role:                 deployer
Role basis:           We license from VendorX and deploy internally [verify against current AI Act text]
Tier:                 high_risk
Tier basis:           Annex III(4)(a) — employment, recruitment selection [verify against current AI Act text]
Obligations assessed: no
Obligations note:     To assess as deployer of a high-risk system: human oversight, input data quality, monitoring, record-keeping, informing workers, Fundamental Rights Impact Assessment if public body/service — see Article 26 [verify against current AI Act text]
Next review:          2026-08-01
Review trigger:       on substantial modification or annually
```

## Why obligations are not derived from a table

The inventory stores role, tier, and the basis for each. It does NOT contain a hardcoded role × tier → obligations mapping.

When the attorney asks "what are the obligations for System X?", perform the analysis **in conversation**, tagged `[verify against current AI Act text]`, routing to a full impact assessment for anything that needs a formal record.

This is deliberate:
- Article mapping is complex and the AI Act is phasing in through 2027.
- A confident-but-wrong compliance obligation conclusion ends up in a board memo or a regulatory filing.
- The inventory is a registry for the attorney. **The attorney owns the obligation analysis.**

## Jurisdiction note

The EU AI Act is an EU/EEA regulation. This skill defaults to EU/EEA scope. If the attorney is advising a US-only client with no EU nexus, the EU AI Act does not apply — note that assumption and ask whether any other AI governance frameworks (US state laws, sector-specific rules, or voluntary frameworks) are relevant instead.

For North Carolina or US-specific AI governance questions where the EU AI Act is not the frame, use web search to identify current applicable law or guidance, and surface that separately.

## Guardrails

- **Never classify silently.** The walk-through must be visible.
- **`[verify against current AI Act text]` tags stay.** Do not strip them from outputs — they are the point, not hedging.
- **Flag substantial modification.** Whenever a system is modified beyond configuration, prompt the attorney to re-run classification — modification can change the role from deployer to provider.
- **Do not declare obligations from a table.** If asked, do the analysis in conversation.
- **Do not invent firm positions.** Apply the client's stated AI governance positions if the attorney provides them in context. If a position is not given, ask one short question or apply a conservative default and explicitly flag the assumption.
- **This is not legal advice.** Every classification, tier assignment, and obligation note is a draft for attorney review. The attorney owns the legal conclusion.
