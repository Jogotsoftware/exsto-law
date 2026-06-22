---
slug: ip.takedown
name: Digital Millennium Copyright Act Takedown and Counter-Notice
practice_area: ip
description: Draft a DMCA §512(c)(3) takedown notice, triage an incoming takedown, or draft a §512(g)(3) counter-notice — with fair-use gate, perjury gate, and four-option triage for received notices.
when_to_use: When the attorney needs to send a DMCA takedown, respond to a takedown a client received, or draft a §512(g)(3) counter-notice to restore taken-down content.
user_invocable: true
---

# DMCA Takedown and Counter-Notice

Three modes. If the attorney does not specify one, ask once:

> "Are we sending a DMCA takedown, triaging one we received, or drafting a counter-notice?"

- **Send mode** — draft a §512(c)(3) takedown notice with fair-use gate and perjury gate before any notice is finalized.
- **Respond mode** — triage a takedown the client received; produce four options with a recommendation.
- **Counter mode** — draft a §512(g)(3) counter-notice with the federal-jurisdiction admission gate and perjury gate.

> **Every output is a draft for attorney review. Nothing here is a legal opinion or ready-to-send notice. The attorney owns the legal conclusion and takes professional responsibility before any notice or counter-notice is submitted.**

## Jurisdiction assumption

DMCA §512 is **US federal law** running against service providers subject to US jurisdiction. If the service provider, content host, or infringer sits outside the US — or the client is a non-US rights holder — flag it before drafting. Other regimes (EU Digital Services Act Art. 16, UK Online Safety Act, India IT Rules 2021, etc.) have materially different elements, counter-notice mechanics, and liability consequences. A US DMCA notice may be the wrong instrument, or may need to be paired with a local-regime notice. Copyright subsistence is Berne-multilateral; enforcement mechanics are jurisdiction-specific.

Default jurisdiction assumption: **United States federal copyright law (17 U.S.C. §512)**. Surface this assumption and ask the attorney to confirm if any non-US element is present.

## Approval posture

If the attorney has communicated a firm approval matrix or enforcement posture in the matter context, apply it. If not, apply a conservative default: **no notice or counter-notice is finalized without explicit attorney sign-off**, and flag fair-use calls, authority questions, and ambiguous licensing for attorney determination rather than proceeding on assumption.

---

## Send Mode — Drafting a §512(c)(3) Takedown Notice

### Step 1: Identify the copyrighted work

Ask if not already in context:

- **Title / description** — what is the work (software, image, text, video, audio)?
- **Registration status** — US Copyright Office registration number and date, if any. Registration is not required to send a takedown, but is required to file suit on a US work; pre-infringement registration timing controls statutory damages and attorney's fees.
- **Ownership** — does the client own it outright, or hold an exclusive license with takedown authority? Non-exclusive licensees typically cannot send takedowns on the licensor's work.
- **Prior licensing** — has this use, or a broader use that might cover it, ever been licensed?

Ownership and authority are the first things §512(f) cases examine. Establish them clearly before drafting.

### Step 2: Identify the infringing material and its location

- **Platform / service provider** — YouTube, GitHub, Reddit, Amazon, a web host, etc.
- **URL(s)** — specific permalinks to the infringing material. One notice may cover multiple URLs at the same service provider.
- **Description** — what the infringing material is and how it infringes (verbatim copy, substantially similar, derivative work).
- **Evidence** — confirm screenshots or cached copies with timestamp and URL visible have been preserved before sending.

§512(c)(3) requires "information reasonably sufficient to permit the service provider to locate the material." Precise URLs are usually sufficient.

### Step 3: Fair-use gate (*Lenz*)

Under *Lenz v. Universal Music Corp.*, 801 F.3d 1126 (9th Cir. 2015) — **verify on legal research**, flagged `[model knowledge — verify]` — a copyright holder must consider fair use before sending a takedown. This is a required consideration step, not a final judgment.

Walk the four factors with the attorney:

1. **Purpose and character** — commercial? transformative? criticism, comment, news reporting, teaching, scholarship, or research?
2. **Nature of the copyrighted work** — factual or creative? published or unpublished?
3. **Amount and substantiality** — how much of the work is used? Is the heart of the work taken?
4. **Effect on the market** — does the use substitute for the original or harm a derivative market?

Ask the attorney for a read on each factor and a conclusion: *fair use unlikely / debatable / likely?*

Record the conclusion. **If the answer is "debatable" or "likely," do not draft the notice.** Stop and surface this:

> Fair use is debatable/likely on these facts. Sending a takedown on a use that may be protected by fair use is precisely the §512(f) exposure the statute was written to deter. The attorney should evaluate before any notice is prepared.

### Step 4: Good-faith belief

§512(c)(3)(A)(v) requires "a statement that the complaining party has a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law."

Confirm with the attorney:

- The work is theirs, or they hold an exclusive license with takedown authority.
- The use is not authorized — no prior license, no implied license, no Creative Commons grant that covers it.
- Fair use was considered (Step 3) and the conclusion was "unlikely."
- The attorney or client has personally reviewed the accused content (not just a third-party report about it).

If any of these are not confirmed, pause before continuing.

### Step 5: Accuracy and agent authority

§512(c)(3)(A)(vi) requires a statement that the information is accurate, and **under penalty of perjury**, that the complaining party is authorized to act on behalf of the owner of the exclusive right allegedly infringed.

Confirm: who is signing, on behalf of whom, and what is the basis for their authority to do so?

### Step 6: Draft the notice

Every §512(c)(3)(A) element must be present or the notice is defective:

1. **Signature** (physical or electronic) of the rights holder or authorized agent
2. **Identification of the copyrighted work** — title, description, registration number if any
3. **Identification of the infringing material** with location — URL(s), description, how it infringes
4. **Contact information** — name, address, phone, email of the complaining party or authorized agent
5. **Good-faith belief statement** — verbatim (adapt only name/pronoun): *"I have a good faith belief that use of the copyrighted material described above is not authorized by the copyright owner, its agent, or the law."*
6. **Accuracy and authority statement under penalty of perjury** — verbatim (adapt only): *"I swear, under penalty of perjury, that the information in this notification is accurate and that I am the copyright owner, or am authorized to act on behalf of the owner, of an exclusive right that is allegedly infringed."*

Structure:

```
[Sender name and address]
[Date]

To: DMCA Designated Agent, [Service Provider]
[Designated agent address or web-form URL]

Re: Notice of Copyright Infringement pursuant to 17 U.S.C. §512(c)

1. Identification of the copyrighted work: ...
2. Identification of the infringing material and its location: ...
3. Contact information: ...
4. Good-faith belief statement: ...
5. Accuracy and authority statement under penalty of perjury: ...

[Signature]
```

Note the service provider's preferred intake path — most major platforms provide a web form or designated email address. Use web_search to locate the current designated agent in the Copyright Office's DMCA Designated Agent Directory (`https://www.copyright.gov/dmca-directory/`) if not already known. Note in the output which submission path applies.

### Step 7: Pre-delivery gate

Present this block to the attorney before finalizing any notice:

```
┌─────────────────────────────────────────────────────────────┐
│  BEFORE THIS NOTICE GOES ANYWHERE                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  A DMCA takedown is a statement under penalty of perjury.  │
│  Signing and sending it is not a routine step — it is a    │
│  sworn declaration with specific legal consequences.        │
│                                                             │
│  • 17 U.S.C. §512(f) creates liability for knowing         │
│    material misrepresentations. Cases on point:            │
│    Lenz v. Universal Music Corp., 801 F.3d 1126            │
│    (9th Cir. 2015); Online Policy Group v. Diebold,        │
│    337 F. Supp. 2d 1195 (N.D. Cal. 2004); Stephens v.     │
│    Clash, 796 F.3d 281 (3d Cir. 2015).                    │
│    [model knowledge — verify on legal research]            │
│                                                             │
│  Confirm before the notice is sent:                        │
│                                                             │
│    1. Client owns the copyright or holds an exclusive      │
│       license with takedown authority.                     │
│    2. The accused use is not authorized — licenses,        │
│       grants, and prior consents have been checked.        │
│    3. Fair use was considered per Lenz (Step 3 above);     │
│       the conclusion is on the record.                     │
│    4. The authorized signer has approved sending.          │
│                                                             │
│  The attorney is responsible for this send decision.       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Do not present the final notice draft without the attorney's explicit confirmation at this gate.

### Step 8: Output

Present the notice as plain text in chat for the attorney to review, edit, and iterate before finalizing. Include a closing note on every in-chat draft:

> This is a draft DMCA §512(c)(3) notice for attorney review — not a notice ready to send. Sending it is a sworn statement with §512(f) exposure. The attorney reviews, edits, and takes professional responsibility before submission. Do not submit this unreviewed.

After the attorney is satisfied, they may save the draft in the app and submit through the service provider's designated channel.

---

## Respond Mode — Triaging a Takedown Received

The client's content was taken down. The service provider notified them of a §512(c)(3) notice. Four options exist; the attorney decides which to take.

### Step 1: Extract from the notice

If the attorney pastes or describes the notice, extract:

- **Sender** — entity, signer, address, contact information; counsel if identified
- **Service provider** — which platform notified the client
- **Claimed work** — what the sender claims as theirs
- **Client's content targeted** — URL(s) or identifiers as named in the notice
- **Date of takedown / notice**
- **Whether the notice meets §512(c)(3) on its face** — flag any missing elements; a defective notice is not a proper notice

### Step 2: Assessment

Work through with the attorney:

- **License / authorization** — does the client have a negotiated license, implied license, Creative Commons grant, prior settlement, assignment, or any other authorization that covers this use?
- **Fair use** — walk the *Lenz* four factors honestly; this analysis is internal and privileged, not the response.
- **Notice defects** — is any §512(c)(3)(A) element missing? Is the perjury statement absent? Is the signer someone without apparent authority? Defective notices are not proper notices; the host may still act on them, but the sender's §512(f) exposure rises and the client's leverage rises.
- **Host compliance with §512(g)** — was the client given notice and opportunity to counter? If the host acted without that, that is a separate issue with the host.
- **Sender credibility** — pattern of overbroad takedowns? Known copyright troll?

### Step 3: Four options

Present all four options with tradeoffs, then give a recommendation with brief rationale. Do not pick for the attorney; surface the analysis.

**A — Comply (let the takedown stand)**
- When: the sender is right, or the dispute is not worth the cost or risk.
- Tradeoff: content stays down; may affect search rankings, platform strike counts, revenue, or client operations.
- Next step: log the event; confirm no counter-notice deadlines inadvertently missed.

**B — Counter-notice (§512(g)(3))**
- When: the client has a good-faith belief the material was removed by mistake or misidentification — typically because the use is licensed, fair use, or the sender does not actually own the claimed work.
- Tradeoff: sworn under penalty of perjury; consents to federal court jurisdiction in the sender's district (or a designated district if the client is outside the US); puts the decision in the sender's hands for 10–14 business days — if they file suit, content stays down; if they do not, the host must restore it.
- Next step: Counter mode (below) after the attorney decides deliberately to proceed.

**C — Engage the sender directly**
- When: there is room for a business resolution — a license, credit, or narrower takedown.
- Tradeoff: content stays down during the conversation; settlement-communication privilege (FRE 408 or equivalent) protects substance, not just labeling.
- Next step: draft an outreach letter to the sender; do not file a counter-notice while discussions are active.

**D — Do nothing for now; preserve rights**
- When: the harm is small, the client does not want to make the federal-jurisdiction admission, or they prefer to deal with the sender separately.
- Tradeoff: content stays down; if the original takedown was bad-faith, the client may have a §512(f) claim to assert on their own schedule — but that is a separate proceeding.

Recommend one option with two sentences of rationale. Flag that the attorney confirms before executing.

### Step 4: Triage memo

Present in chat as a structured memo:

```
PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION / ATTORNEY WORK PRODUCT
Prepared by: [firm name] | For: [attorney name] | Matter: [matter name if in context]

PRIVILEGE NOTE: This triage records the initial assessment of an adverse DMCA takedown.
Do not forward outside the privilege circle. Do not attach to counter-notice submissions
without scrubbing.

DMCA TAKEDOWN RECEIVED — TRIAGE MEMO
READ FOR TRIAGE, NOT OPINION. Structured intake scan, not a legal merit opinion.
Every authority flagged for attorney verification; every merit call is counsel's.

Date received: [YYYY-MM-DD]
Service provider: [platform]
Sender: [entity, signer, counsel if any]
Claimed work: [title, description, reg. no. if stated]
Client's content targeted: [URLs / identifiers]
Notice meets §512(c)(3) on its face: [yes / no — list any missing elements]

ASSESSMENT
License / authorization: [read]
Fair use (Lenz factors):
  1. Purpose and character: [read]
  2. Nature of work: [read]
  3. Amount and substantiality: [read]
  4. Market effect: [read]
  Conclusion: [unlikely / debatable / likely] — [SME VERIFY: attorney to confirm]
Notice defects: [list or none]
Host compliance with §512(g): [were client given notice and opportunity?]
Sender credibility: [read]

OPTIONS
A. Comply — [tradeoffs]
B. Counter-notice — [tradeoffs]
C. Engage sender — [tradeoffs]
D. Do nothing — [tradeoffs]

RECOMMENDATION: [A/B/C/D] — [two sentences rationale]
[SME VERIFY: attorney to confirm before executing any option]

DEADLINES
- Counter-notice watch window: 10–14 business days after counter-notice submitted
- If sender files suit within that window: content stays down pending the case
- Check for any platform-specific deadlines with the host

IMMEDIATE ACTION CHECKLIST
[ ] Legal hold issued on the accused content and related client materials
[ ] Business impact assessed (revenue, account strikes, SEO, operations)
[ ] Matter opened or confirmed in the app
[ ] Counsel assigned and confirmed
```

Close with:

> This is a triage memo, not legal advice. The assessments above are a first read of the notice. An attorney evaluates before the client counters (which consents to federal jurisdiction) or decides not to respond.

---

## Counter Mode — Drafting a §512(g)(3) Counter-Notice

Counter-notices put content back up unless the original sender files suit within 10–14 business days. They are the step immediately before potential litigation.

### Step 1: Confirm the predicate

Before drafting, confirm with the attorney:

- The content was taken down in response to a §512 notice — not a terms-of-service action by the host itself.
- The client has a good-faith belief the material was removed by mistake or misidentification — because the use is licensed, fair use, not actually infringing, or the sender does not own the claimed work.
- The client is prepared to consent to federal court jurisdiction in the original sender's district (or designate a district if they are outside the US).
- This decision has been made deliberately — not reactively, and with attorney input.

If any element is not confirmed, stop and route back to the attorney before proceeding.

### Step 2: Draft per §512(g)(3)

Every element must be present or the counter-notice is defective:

1. **Signature** (physical or electronic) of the subscriber (the client)
2. **Identification of the material removed** and its location before removal — the URL where the content appeared
3. **Statement under penalty of perjury** that the subscriber has a good-faith belief the material was removed or disabled as a result of mistake or misidentification — verbatim (adapt only): *"I swear, under penalty of perjury, that I have a good faith belief that the material identified above was removed or disabled as a result of mistake or misidentification of the material to be removed or disabled."*
4. **Subscriber's name, address, and telephone number**, plus **consent to the jurisdiction of the federal district court** for the district where the subscriber's address is located (or, if outside the US, any judicial district in which the service provider may be found), and **acceptance of service of process** from the original sender or their agent

Structure:

```
[Subscriber name and address]
[Date]

To: DMCA Designated Agent, [Service Provider]
[Designated agent address or web-form URL]

Re: Counter-Notification pursuant to 17 U.S.C. §512(g)

1. Identification of the material removed and its prior location: ...
2. Statement under penalty of perjury (good-faith belief of mistake or
   misidentification): ...
3. Subscriber contact information and consent to federal jurisdiction: ...
4. Acceptance of service of process: ...

[Signature]
```

### Step 3: Pre-delivery gate

Present this block to the attorney before finalizing any counter-notice:

```
┌─────────────────────────────────────────────────────────────┐
│  BEFORE THIS COUNTER-NOTICE GOES ANYWHERE                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  A DMCA counter-notice is a statement under penalty of     │
│  perjury AND consents to federal court jurisdiction.        │
│  It is the step immediately before potential litigation.    │
│                                                             │
│  • If the original claimant files suit within 10–14        │
│    business days of the counter-notice, content stays      │
│    down pending the suit. 17 U.S.C. §512(g)(2)(C).        │
│    [model knowledge — verify]                              │
│                                                             │
│  • If they do not sue in that window, the host must        │
│    restore the content within 14 business days.            │
│                                                             │
│  • The client is consenting to be sued in federal court    │
│    in the claimant's judicial district. This is a          │
│    real jurisdictional admission made by signing.          │
│                                                             │
│  • §512(f) liability runs in both directions — senders     │
│    and counter-senders. The perjury statement is real.     │
│                                                             │
│  Confirm before the counter-notice is sent:                │
│                                                             │
│    1. Content was taken down via a §512 notice             │
│       (not a TOS action by the host).                      │
│    2. Client has a good-faith belief the removal was       │
│       a mistake or misidentification — because the use     │
│       is licensed, fair use, not infringing, or the        │
│       sender does not own the work.                        │
│    3. Client is prepared to be sued in federal court       │
│       in the claimant's district. Budget, counsel,         │
│       and risk tolerance are all considered.               │
│    4. Attorney has reviewed this before it is sent.        │
│                                                             │
│  The attorney is responsible for this send decision.       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Do not present the final counter-notice draft without the attorney's explicit confirmation at this gate.

### Step 4: Output

Present the counter-notice as plain text in chat for the attorney to review and iterate. Include on every in-chat draft:

> This is a draft §512(g)(3) counter-notice for attorney review — not a counter-notice ready to send. Sending it is a sworn statement and consents to federal court jurisdiction in the claimant's district. The attorney reviews before submission. Do not submit this unreviewed.

After the attorney is satisfied, they may save the draft in the app and submit to the service provider's designated agent.

---

## Decision posture on subjective legal calls

When uncertain whether the use is fair, whether ownership or exclusive-license authority is established, whether a license covers the accused use, or whether a notice defect is dispositive — do not silently decide. These are one-way doors. Flag for attorney review and surface the factors. Apply the most conservative option until the attorney confirms otherwise.

## What this skill does not do

- **Submit any notice.** Drafting only. The attorney or client submits through the service provider's designated channel.
- **Decide fair use.** Walks the four *Lenz* factors and flags; the attorney decides whether to proceed.
- **Validate the sender's claim on the receive side.** Structured read only; every merit call is counsel's.
- **Bypass the gates.** The perjury/pre-delivery gate runs in Send and Counter modes every time.
- **Produce verified citations.** Any case or statutory citations are tagged `[model knowledge — verify]` and must be confirmed on a legal research tool (use web_search or sources the attorney provides) before reliance. Do not present citations as verified unless they have been checked.
- **Handle non-US regimes.** DMCA §512 is US-specific. For EU DSA Art. 16, UK Online Safety Act, India IT Rules, or other notice-and-action regimes, flag and route — do not apply DMCA mechanics to a different statutory framework.
