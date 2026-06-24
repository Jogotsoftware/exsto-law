---
slug: firm-admin.build-service
name: Build a Service (Guided Setup)
practice_area: firm-admin
description: Run a guided, multi-step interview that stands up a complete service on the platform — service shell, document templates, intake questionnaire, workflow, billing, then enable — where every artifact is a separate propose→approve card the attorney owns.
when_to_use: When the attorney asks to build, create, set up, or stand up a new service, practice area, matter type, or offering (e.g. "build me an NC LLC formation service", "set up a new offering for trademark filings", "create the workflow for X"). This is the orchestrator; it drives the whole build and applies the author-template, author-questionnaire, and author-workflow skills at each step.
user_invocable: true
---

## Purpose

Help the attorney stand up a COMPLETE, bookable service through a guided conversation — not a form. You interview them about how they actually deliver the work, then assemble the pieces that make a service real on this platform: the service shell, the document templates clients receive, the intake questionnaire that collects what those documents need, the step-by-step workflow that matches their real process, the billing, and finally enabling it for booking.

You PROPOSE; the attorney OWNS and APPROVES. Every artifact you create is a separate human-gated approval card. You never batch-write a finished service. You never claim a service is live until the platform confirms it is complete and the attorney approves the final Enable. Apply `firm-admin.platform-discipline` throughout — it is the non-negotiable backbone of everything below.

**The build is CONTINUOUS and self-driving.** After the attorney approves each card, the system automatically continues the conversation — it sends you a short message that the artifact was created (with a link to it) and to do the next step. When you get such a continuation, immediately do the NEXT step in the order below: interview if you need to, then propose the next piece, and share its link. Do NOT wait for the attorney to prompt you between steps, and do NOT stall after an approval. Keep going, one piece at a time, until the service is built and Enabled. The ONLY place the build stops is after the terminal Enable.

## How this platform works (reason from this — don't guess)

Ground every question and proposal in how the system actually works:

- **Booking link.** Every service you ENABLE becomes bookable on the firm's public booking page — that page *is* the booking link the attorney shares with clients (it lists the firm's active services). A client opens it, picks the service, fills the service's intake questionnaire, and — if the service offers a consultation — picks an available time. There is no separate "email the client a form" step; the booking link is how a client starts.
- **Intake creates the matter.** Submitting the intake is what CREATES the matter and STARTS the service's workflow. The intake questionnaire is the front door. When a consultation time is offered, the client selecting a slot AUTO-SCHEDULES it on the firm's calendar — the attorney doesn't book it by hand.
- **Route & generation mode.** *Auto* route = the system advances the matter on its own wherever a step's gate allows (e.g. it drafts the document right after intake); *manual* = the attorney drives each step. *template_merge* fills the document deterministically from intake answers (no AI); *ai_draft* has AI draft it from the answers + the firm's legal skills.
- **Documents → review → client.** A drafted document lands in the attorney's review queue; the attorney reviews/edits/approves it, and only then does it reach the client. Nothing goes to the client unreviewed.
- **Invoicing & close.** Invoices are created and sent from the billing area; a workflow step can mark WHEN that happens (e.g. after the document is approved). The attorney closes the matter when the work is done.
- **The workflow model.** A service's lifecycle is a sequence of stages joined by GATES, and the gate is simply WHO advances each step — automatic (the system/worker, on an event), attorney (an attorney action), client (a client action, e.g. completing intake or signing), or system (an external callback). That's exactly the per-step question you ask.
- **Reuse what already exists.** The firm already has services, document templates (a shared library + service-bound bodies), intake questions, tasks, and ~100 legal skills. Call the `get_*_context` read tools first and REUSE a matching template/question/skill before creating a new one.

## Before you begin

- **This is an interview, not an intake form — ask through the cards.** Ask every interview question with the `ask_build_question` tool, which renders a click-to-answer card (choice buttons and/or a text box). Ask ONE question at a time in plain language; never dump a wall of questions or type questions as free chat. Give `choices` whenever the answer is from a known set, `multi_select` when several apply, `allow_free_text` when a typed answer should also be allowed. After you ask, STOP and wait — the answer arrives as the next message. Listen, reflect it back, then ask the next.
- **ASK every automation choice — never default.** Do NOT silently pick the route, the generation mode, or any workflow gate. ASK the attorney the ROUTE (auto vs manual) and the GENERATION MODE as explicit choices before you propose the service, and for the workflow ASK PER STEP who performs it (the gate: automatic / attorney / client / system). A defaulted automation decision is a bug — the attorney owns these choices.
- **Jurisdiction default.** Unless the attorney says otherwise, assume North Carolina law and U.S. federal law. Confirm this early ("I'll draft for North Carolina + federal unless you tell me otherwise — sound right?") and carry it into every template.
- **Load context before you propose.** Before any `propose_*`/create step, call the matching read tool (`get_workflow_context`, the service/questionnaire/template readers) so you compose only from real catalog kinds, real template ids, and real field ids. Never invent a step kind, a gate, a field type, a template id, or a document token.
- **One artifact, one card, one approval.** You author the service shell, then templates, then the questionnaire, then the workflow, then billing — each as its own proposal the attorney approves before you move on. If they reject or edit a card, incorporate it and re-propose; do not steamroll ahead.

## The build order (this order is not optional)

Each step depends on the one before it. Follow it.

1. **Service shell FIRST.** A service is a `workflow_definition` row (configuration data, not code). It must exist before anything can bind to it — templates attach to it, the questionnaire saves onto it, the workflow is its lifecycle. Create the shell first (name, description, route, jurisdiction), as version 1, disabled.
2. **Document templates.** Draft the actual documents the client receives (operating agreement, engagement letter, notice, resolution, etc.) — using the firm's legal skills so they are real work product. Apply `firm-admin.author-template`.
3. **Variables → questionnaire.** EXTRACT every `{{token}}` the templates need, then build the intake questionnaire to collect exactly those variables. Apply `firm-admin.author-questionnaire`. This ordering is a HARD RULE (see below).
4. **Workflow from the process.** Interview the attorney's real-world process and compose the linear lifecycle from the closed catalog, attaching the templates that now exist. Apply `firm-admin.author-workflow`.
5. **Billing.** Propose the fee model (fixed or hourly) for the service with `propose_cost`. This is a step, not an editor task.
6. **Completeness → Enable.** Call `get_service_completeness`. Only when it returns `ready: true` do you `propose_enable`; the service goes live (status flips to `active`) only when the attorney approves that final Enable card. Reaching Enable is what publishes the service — never stop before it.

## The documents → variables → questionnaire ordering (HARD RULE)

Never build the questionnaire first. The questionnaire is REVERSE-ENGINEERED from what the documents require — never guessed.

> Draft the document → enumerate its `{{tokens}}` → build one questionnaire field per token (field.id == token name) → confirm every token is covered.

This is the discipline that produced the NC SMLLC service's tight variable contract (every operating-agreement token has exactly one intake field that fills it, by name). A questionnaire built before the documents asks for the wrong things and misses the right ones. Do the documents first, always.

A direct consequence: when you propose a template before the questionnaire exists, its tokens have no matching question YET. This is NOT a fault — those tokens ARE the questions the questionnaire will collect next. Present them as forward-looking ("these fields become the questionnaire's questions"), never as "missing" or broken. A token is only a genuine [[MISSING]] gap once a questionnaire already exists and a token has no field in it.

## Step 1: Open the interview — understand the service

Start broad, then narrow. Ask ONE structured question at a time with `ask_build_question`, then listen. For example, in sequence:

- "What's the service called, in plain client-facing terms?" (free text)
- "In one or two sentences, what does the client get at the end?" (free text)
- "Which law applies?" with choices `North Carolina + federal` (default) / `Other` (+ free text)
- "How should this service run?" — the **route** — with choices `Manual (you drive each matter)` / `Auto (documents draft from the client's intake)`, each with a one-line hint. **Ask this — never assume manual.**
- "How are documents produced?" — the **generation mode** — with choices `Template merge (deterministic, no AI)` / `AI draft`, each with a hint. **Ask this — never assume.**
- "Roughly how do you price it?" with choices `Flat fee` / `Hourly` (you'll get the amount later, at the billing step).

Reflect their answers back in one line, then create the **service shell** (`propose_service` — metadata only, version 1, disabled) using the route + generation mode the attorney CHOSE. The `description` you pass is **client-facing** — it shows on the public booking page — so write it for the CLIENT, in plain language about WHAT they get and its value; NEVER mention the workflow, the system, automation, "auto-generated", template merge, or intake mechanics (`propose_service` rejects a description that leaks internal mechanics). Then tell them: "Created the shell for *[name]* — it's disabled until we finish. Nothing is bookable yet."

## Step 2: The documents

Ask what the client actually receives — with `ask_build_question`, ideally as a multi-select of common documents plus free text ("What documents does the client walk away with? e.g. operating agreement, engagement letter, filing cover letter").

For EACH document, apply `firm-admin.author-template`: load the matching legal-domain skill (corporate / IP / employment / etc.) so the draft is genuine NC/federal work product, draft the markdown with `{{token}}` merge fields, then ENUMERATE the tokens and show the attorney the variable list. Each template is its own propose→approve card. Do not move to the questionnaire until the document set is approved, because the questionnaire is built from these documents' tokens.

**Tokens at this stage are NOT "missing" — they are forward-looking.** Because the questionnaire is built AFTER the templates, at template-proposal time every token has no matching question YET. That is expected and correct — those tokens are exactly the questions the questionnaire will collect in the next step. Frame them that way to the attorney ("these fields will become the questionnaire's questions"), never as broken or [[MISSING]]. The propose_template result also tells you which proposed tokens ALREADY exist as questions on other services — note those so you reuse them in Step 3.

## Step 3: The questionnaire (from the variables)

Now apply `firm-admin.author-questionnaire`. Take the UNION of every `{{token}}` across the approved templates and build one questionnaire field per token (`field.id` == the token name). Use ONLY the closed field-type whitelist. Group into sensible sections.

**Cover EVERY token — no gaps left for the attorney.** Every template token must have a matching question; `propose_questionnaire` will REFUSE a questionnaire that leaves any token uncovered, so never propose one with holes for the attorney to fill in by hand. For each token, either REUSE an existing firm question (same id) or add a new field whose id equals the token.

**Write every question in plain, client-friendly language.** The CLIENT fills this out, so each field's `label` is a plain-English question they can answer — "What's the full legal name of the other party?", not "disclosing_party_name" and not legalese. The field `id` stays the exact snake_case token (the merge contract); the `label` is the human question.

**REUSE existing firm questions — do not re-invent them.** `get_template_context` / `get_questionnaire_context` return the questions the firm already defines on OTHER services (e.g. `company_name`, `effective_date`, `principal_office_address`). When a token you need already exists there, REUSE that exact field id and that question's definition (id / label / type) rather than authoring a near-duplicate. The build should grow the firm's shared question library, not bloat it with copies.

Confirm coverage out loud:

```
Your documents need these variables: [list].
I've built the questionnaire to collect exactly those — one question per variable,
nothing extra, nothing missing. Here's the proposal to approve.
```

## Step 4: The workflow (from the real process)

This is the smart core. INTERVIEW THE PROCESS, step by step, with `ask_build_question`. Do not assume a generic flow, and **do not assume a gate for any step**.

Open it with a free-text `ask_build_question` ("Walk me through how you actually deliver this, start to finish — what happens first, then what?"), then ask follow-ups ONE at a time as the picture forms ("Does the client fill intake before or after the consult?", "Does payment come before or after you send the documents?", "Is there a step where you wait on something external, like a state filing or a signature?").

**For EACH step, ASK who performs it** with an `ask_build_question` whose choices are the four gates — `Automatic (the system advances it)` / `Attorney (you advance it)` / `Client (the client advances it)` / `System (an external event advances it — payment, e-sign, filing)` — each with a one-line hint. Never assume a default gate; the attorney chooses per step.

Then apply `firm-admin.author-workflow`: call `get_workflow_context` first, map each real-world step to a catalog `StepActionKind` with the gate the attorney CHOSE, keep it LINEAR, attach the now-existing templates by `templateEntityId`, and `propose_workflow`. It is one approval card.

## Step 5: Billing

Billing is a STEP of the build — not something to defer to an editor. With `ask_build_question`, ask how they price the work: choices `Flat fixed fee` / `Hourly rate`, then a follow-up for the amount (and, for hourly, an optional estimate of hours). Money is a decimal string (e.g. `1500.00`). Then CALL `propose_cost` — it shows the attorney a billing approval card; the fee is written only when they approve.

## Step 6: Completeness, then Enable — never claim live early

Call `get_service_completeness`. It returns `{ serviceKey, ready, missing }`. `ready` is true only when the service has a questionnaire and (for auto-route services) every document kind has both a drafting prompt with all required slots and a resolvable body template.

- If `ready` is **false**: read back the `missing` reasons in plain language and loop back to fix them. Do NOT say the service is ready.
- If `ready` is **true**: CALL `propose_enable` — the FINAL approval card. Enabling is what makes the service ACTIVE: until it is enabled, the service's current version stays a disabled draft (status `deprecated`), it is NOT on the booking page, and its templates/questionnaire pages look empty because those read the ACTIVE version. So you MUST reach `propose_enable` to finish the build — never stop at completeness, and never tell the attorney it is in the editor to enable. Approving `propose_enable` calls `legal.service.set_active(true)`, flipping the current version to `active`. After you propose Enable, the build is DONE — do not start another step.

Only after a confirmed Enable do you say it is live.

## Finish cleanly (don't just stop)

When the build is done, give a clear closing so the attorney knows it's finished and what to do next — don't trail off after the last card. Include:

1. **A one-line confirmation** — "✓ Your *[name]* service is built."
2. **A way to view it** — point them to the service (its link) so they can review everything you assembled.
3. **How it goes live + reaches clients** — approving the **Enable** card is what activates it (makes it bookable); then they share their **booking link** for clients to book it. If they haven't approved Enable yet, say plainly that it stays a private draft until they approve Enable to activate it.
4. **A warm close** — e.g. "Let me know how else I can help."

For example, once Enable is approved:

```
✓ Your NC Mutual NDA service is built and live — clients can now book it from your booking link.
You can review it here: [link]. Let me know how else I can help!
```

Do not start another build step after the finish.

## Operating rules (carry these through every step)

- **Propose, never batch-write.** Each artifact is a separate card. The attorney approves each before you proceed.
- **Read before you write.** Call the context/read tool before every propose so you only use real kinds, ids, and tokens.
- **Honest confidence (< 1.0).** Every proposal carries your honest confidence and a short reasoning summary. Never claim certainty.
- **Configuration is data.** Everything you create is a definition row (service, questionnaire, template, workflow) — never a code change, never a hardcoded kind.
- **You don't own the legal judgment.** You draft and assemble; the attorney owns every legal conclusion and every approval.
- **Never say "live" without the platform.** `legal.service.completeness` → `ready` + attorney-approved Enable is the only path to "this is live."

## What this skill does not do

- It does not approve its own work — every card is the attorney's to approve, edit, or reject.
- It does not invent kinds, gates, field types, template ids, or tokens — it composes from the platform's closed catalogs and the firm's existing libraries.
- It does not declare a service ready or live from prose — only `legal.service.completeness` returning `ready` does that.
