---
slug: ip.oss-review
name: Open Source Software License Review
practice_area: ip
description: Classify dependencies by license family, map obligations to the deployment model, flag copyleft and unknown licenses, and produce an attorney-ready compliance memo with recommended actions.
when_to_use: When a client or the attorney asks whether a library or dependency can ship, when reviewing a manifest/SBOM/repo for copyleft obligations and license compatibility, or when a client is preparing to open-source their own code.
user_invocable: true
---

# Open Source Software License Review

Runs an open source license compliance check for a dependency list, a single library, or outbound code a client plans to release. Classifies dependencies by license family, maps obligations to the deployment model, flags license-unknown and non-OSI-posing-as-OSS packages, and recommends actions — comply, replace, remove, seek legal review, seek commercial license.

> **Every output of this skill is a draft for attorney review — not legal advice and not a legal opinion.** Copyleft analysis depends on deployment model, linking degree, jurisdiction, and sometimes on legal questions that have not been tested in court. For anything classified as strong copyleft or license-unknown, an attorney evaluates before the dependency ships or the code is released. You report what you found; the attorney decides what to do.

**Jurisdiction assumption:** US law governs unless stated otherwise. North Carolina courts are the default forum for any downstream dispute unless the client's agreements specify otherwise. Surface this assumption in the memo.

---

## Step 1 — Establish the scope

Identify what is being reviewed. If the attorney or client has not made it clear, ask one short question:

> "What are we reviewing — a dependency list (package.json, requirements.txt, go.mod, Gemfile, etc.), a single library, or the client's own code they plan to open-source?"

The analysis path differs:

- **Dependency list** → classify every entry, roll up obligations.
- **Single library** → classify one package and walk its transitive dependencies if available.
- **Outbound code** → check what's embedded (direct and transitive), verify the chosen outbound license is compatible with all embedded licenses, and check that LICENSE/NOTICE files are correct.

If a matter or client is in context, ground the analysis in it. If no matter is in context, ask which client/matter this is for so the output can be attributed correctly.

---

## Step 2 — Establish the deployment model

This is the single most important input after the license list. The same library carries different obligations depending on how the software is delivered. If not already stated, ask:

> "How will this be deployed — SaaS/hosted service, distributed binary (desktop/mobile/on-prem/CLI), internal use only, or embedded/firmware?"

| Deployment | Licenses that materially matter |
|---|---|
| SaaS / hosted service | AGPL (network-trigger), permissive attribution in any UI, SSPL/BUSL/Elastic if repurposing as a competing service |
| Distributed binary | GPL, LGPL, MPL, EPL (all trigger on distribution), permissive attribution |
| Internal only | Most copyleft does not trigger — no distribution. Permissive attribution still good hygiene. AGPL still triggers if users outside the company interact over the network. |
| Embedded / firmware | GPL is especially hard to comply with (source disclosure + reproducible build + installation information in some cases). Plan before shipping, not after. |

Flag the deployment model in the output memo — the same dependency list reviewed against "SaaS" vs. "distributed binary" yields different obligations.

---

## Step 3 — Apply the firm's OSS policy positions

If the attorney has provided an OSS policy, accepted/review/banned license list, or escalation rules in context, apply those as the source of truth.

If no policy is provided, use conservative defaults: treat any strong copyleft or unknown license as requiring attorney review before the dependency ships. Explicitly flag this assumption in the memo: *"No OSS policy was provided — conservative defaults applied. If the firm or client has a standing policy, provide it and I will re-run."*

Never invent firm-specific positions as authoritative.

---

## Step 4 — Classify each dependency

For every package, determine the license. Rely on license text and documents the attorney provides; supplement with web_search where needed and tag those results `[web search — verify]`. Do not treat package manager metadata as definitive — LICENSE files can be wrong and metadata can be stale.

Classify into:

| Bucket | Examples | Key obligations |
|---|---|---|
| **Permissive** | MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, Zlib, Unlicense | Attribution, preserve license text; Apache-2.0 adds patent grant + NOTICE requirement |
| **Weak copyleft** | LGPL-2.1, LGPL-3.0, MPL-2.0, EPL-1.0, EPL-2.0, CDDL | File-level or library-level source disclosure; linking rules vary |
| **Strong copyleft** | GPL-2.0, GPL-3.0, AGPL-3.0, OSL, EUPL (depending on version) | Broad source disclosure; AGPL extends to network use |
| **Public domain / dedication** | CC0, Unlicense, WTFPL | Typically no obligations, but some are contested in jurisdictions that don't recognize public domain dedication |
| **Non-OSI source-available** | SSPL, BUSL, Commons Clause, Elastic License, Confluent Community, fair-source | Not open source — restrict commercial use, competing-service use, or both. Read the specific license. |
| **Other / custom / unknown** | Vendor-specific, proprietary, missing license file, conflict between file and headers | Stop — do not treat as permissive by default |

Also flag:

- **Dual-licensed packages** — which license applies? The choice may change obligations.
- **Deprecated packages** — is there a supported replacement?
- **Packages with a copyleft dependency in their own tree** — top-level license is permissive but a transitive dependency is copyleft.
- **Packages that changed license recently** — Redis, MongoDB, Elastic, HashiCorp — confirm the pinned version is under the expected license.

---

## Step 5 — Map obligations to the deployment model

For each classified dependency, state what the deployment model triggers. Use this block format:

```
### [package@version] — [License]

**Classification:** [Permissive / Weak copyleft / Strong copyleft / Public domain / Non-OSI / Unknown]

**Obligations for our deployment ([SaaS / binary / internal / embedded]):**

- [ ] [Specific obligation — e.g., "Include attribution in a NOTICES file shipped with the app"]
- [ ] [e.g., "If modified and distributed, publish source of modifications"]
- [ ] [e.g., "AGPL network trigger — if users access a modified version over a network, source must be offered to them"]

**Risk:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

**Recommendation:** [Comply with obligations | Replace with [alternative] | Remove | Attorney review before shipping | Seek commercial license from [vendor]]
```

**Linking analysis — required before rating weak copyleft:**

The linking relationship determines whether copyleft actually triggers. Determine or ask:

- **Static linking / compilation together:** Works combined into one binary. Strong signal that copyleft triggers.
- **Dynamic linking / shared library:** Works remain separable at runtime. LGPL explicitly permits this; GPL's position is contested.
- **Header inclusion / inline functions:** Can create a derivative work depending on how much is included.
- **Subprocess / IPC:** Separate processes communicating over well-defined interfaces. Generally not derivative.
- **Network API call:** For most licenses, no. For **AGPL**, the network-interaction clause means serving modified software over a network IS distribution.
- **File-scope copyleft (MPL):** Only modified files carry copyleft, not the whole work.

Static-linked LGPL in a proprietary product is 🔴 Critical. Dynamic-linked LGPL may be 🟢 Low. Same license, opposite rating — do the linking analysis.

**Severity calibration:**

| Level | Means |
|---|---|
| 🔴 Critical | Strong copyleft in a deployment that triggers it (GPL in a distributed binary, AGPL in a SaaS). Non-OSI license that conflicts with the business model. License cannot be determined and the package is load-bearing. |
| 🟠 High | Weak copyleft with obligations the team hasn't satisfied. Dual-licensed where chosen license is ambiguous. License file and headers conflict. |
| 🟡 Medium | Permissive with attribution requirements not yet wired into the build (missing NOTICES file). Transitive copyleft that may or may not trigger depending on consumption. |
| 🟢 Low | Permissive with obligations already satisfied. Copyleft in a deployment model that doesn't trigger it (e.g., GPL library used internally only, no redistribution). |

---

## Step 6 — Flag failure modes

Call out any of the following in a top-of-memo section:

- **License unknown** — classify as "needs review," not permissive. An unclassified dependency should stop a ship decision.
- **License file conflicts with file headers** — read both and report the conflict.
- **Incompatible combinations** — GPL-2.0-only + Apache-2.0 is a known incompatibility; check MPL / EPL / GPL combinations carefully.
- **Non-OSI licenses posing as open source** — SSPL, BUSL, Commons Clause, Elastic License, Confluent Community. Read the license; do not rely on GitHub's "open source" badge.
- **License changes** — if a prior version was permissive and the current version is source-available, the pin matters.

---

## Step 7 — Outbound check (if reviewing client code before open-sourcing)

If the client is preparing to open-source their code:

- Confirm the chosen outbound license is compatible with every embedded dependency (e.g., cannot release under MIT if GPL code is embedded — the combined work must be GPL).
- Confirm a LICENSE file is present and correct.
- Confirm a NOTICE file is present and lists required attributions (Apache-2.0 and others).
- Confirm third-party license texts are bundled where required.
- Confirm no proprietary or confidential code, no customer data, no embedded credentials in the repo history.
- Confirm trademark and brand policy for any project name (separate from the copyright license).

---

## Step 8 — Assemble the memo

Present the memo in chat for the attorney to review (and save in the app if they choose). Use this template:

```
PRIVILEGED AND CONFIDENTIAL
ATTORNEY-CLIENT COMMUNICATION / ATTORNEY WORK PRODUCT
[Firm name] — [Matter / Client name]
Prepared by: AI assistant (draft for attorney review)

# OSS License Review: [Project / Dependency List / Package]

**Reviewed:** [date]
**Scope:** [Dependency list / Single library / Outbound code]
**Deployment model:** [SaaS / Binary / Internal / Embedded]

---

## Bottom line

[Two sentences. Can this ship? What has to happen first?]

**Packages reviewed:** [N]
**By classification:** [N permissive, N weak copyleft, N strong copyleft, N public domain, N non-OSI, N unknown]
**Issues:** [N]🔴  [N]🟠  [N]🟡  [N]🟢

**Attorney review required before shipping:** [Yes / No / Conditional]

---

## Top-of-memo flags

[License-unknown list, license-conflict list, non-OSI-posing-as-OSS list, incompatible combinations]

---

## By package

[Blocks from Step 5, grouped by severity — 🔴 first]

---

## Jurisdiction note

OSS license enforceability varies. AGPL's network trigger has not been broadly tested in court; GPL-3.0's patent clause reads differently under US vs. EU patent law; dedications to public domain are not universally recognized. North Carolina / US law assumed unless stated otherwise. Flag if the client distributes in jurisdictions with materially different IP enforcement.

---

## Outbound check (if applicable)

[From Step 7]

---

## Next steps

[See next-steps decision tree below]
```

> **Privilege and confidentiality.** This memo and any dependency list reviewed may be privileged, confidential, or both. Distribute only within the privilege circle. Do not paste into engineering tickets or external channels without stripping the work-product header and confirming privilege is not waived.

---

## Source tagging

Tag every citation:

- `[SPDX]` / `[OSI]` / `[FSF]` / `[SFC/SFLC]` — guidance from a steward organization
- `[license text — user provided]` — license text read from documents provided in chat
- `[web search — verify]` — retrieved via web_search; check against a primary source before relying
- `[model knowledge — verify]` — recalled from training data; higher fabrication risk

Never strip or collapse tags. If a research query returns no results for a rule the memo needs (e.g., AGPL enforceability in a given jurisdiction), say so and offer options: broaden the search, search the web (tagged `[web search — verify]`), or flag as unverified and stop. The attorney decides whether to accept lower-confidence sources.

---

## Decision posture

When a license cannot be confidently classified, flag it as **"needs review"** — do not call it permissive. Under-classifying license risk is a one-way door: a ship decision made on a permissive-by-default assumption can become a source-disclosure obligation or an injunction months later. Over-flagging is a two-way door — the attorney narrows the list in review.

When the copyleft-trigger analysis turns on a contested question (AGPL's "interacts over a network," GPL-3.0's "conveying," the scope of LGPL linking), flag for attorney review and surface the factors cutting both ways.

---

## Quality checklist before delivering

- [ ] Deployment model established before classifying obligations
- [ ] Every dependency has a classification, including transitives where available
- [ ] License-unknown packages flagged, not defaulted to permissive
- [ ] License text read (not just metadata) for any copyleft or non-OSI finding
- [ ] Linking analysis done for any weak copyleft finding
- [ ] Source tags applied to all citations; no stripped `verify` tags
- [ ] OSS policy positions sourced from context or conservative defaults flagged explicitly
- [ ] Jurisdiction assumption surfaced
- [ ] Work-product header prepended
- [ ] Output is presented as a draft for attorney review — not as legal advice

---

## Next-steps decision tree

End every review with a decision tree tailored to what was found. Default branches:

1. **Comply** — obligations are manageable; walk through what needs to be done before ship.
2. **Replace** — flag the specific packages and suggest alternatives to research.
3. **Remove** — dependency is not worth the compliance cost; confirm the client can drop it.
4. **Attorney review before shipping** — strong copyleft or unknown license; do not ship until cleared.
5. **Seek commercial license** — non-OSI or dual-licensed package where the commercial tier removes the obligation; identify the vendor and the right contact.

If more than ~10 packages were scanned, or if the attorney asks, offer a summary dashboard: counts by license family, risk distribution, and a table of findings with severity and package version.
