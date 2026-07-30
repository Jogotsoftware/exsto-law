# Open-gaps work plan — ready-to-paste Claude Code prompts

Six code sessions + a short list of things that aren't code prompts. Written 2026-07-24 from the live-testing walk of the multi-member LLC build plus the standing chatbot/builder audit.

**How to use:** paste §0 (the preamble) followed by ONE prompt body per session. Don't run two sessions against the same checkout — use a worktree per parallel session (shared-checkout thrash has bitten this repo before).

**Suggested order and parallelism:**

```
Independent (safe to run in parallel worktrees):
  1. SB-FIX-1          builder authoring correctness
  4. DOC-RENDER-1      template rendering fidelity
  6. CONTEXT-SETTINGS-1 prompt settings + user/tenant context files

Sequential thread (each builds on the last):
  2. MULTI-PARTY-1  →  3. ESIGN-STEP-1  →  5. MODAL-STD-1

Run last, after everything above has merged:
  7. CHATBOT-CATCHUP-1
```

Start each session with `/efficient` — these prompts name the files to read, so no repo-wide scanning should be needed.

---

## §0. Preamble — paste this at the top of EVERY session

```
Repo: /Users/joe/dev/exsto-law (branch off main). GitHub: Jogotsoftware/exsto-law.
Read docs/PROJECT-STATUS.md first for product context. Root CLAUDE.md governs — its hard
rules are non-negotiable (action layer only, tenant-scoped, append-only, schema-as-data).

Working rules for this session:
- Read only the files named in the task plus what they lead you to. Do not scan the repo.
- Branch off main, one PR, wait for CI green, then squash-merge and delete the branch.
  There is no merge manager — you merge your own PR and apply your own prod migrations.
- CI `verify` = typecheck + lint + format:check + build + test:unit. Run `pnpm format`
  before every push; unformatted code is the #1 cause of red CI here. Lint is strict
  (explicit return types on exports, no unused vars).
- `tsc --noEmit` misses real breakage — prove the build with `pnpm -C apps/legal-demo build`.
- `pnpm test:unit` runs an EXPLICIT FILE LIST in package.json. A new test file that isn't
  added to that list silently never runs.
- Migrations: number above BOTH `git ls-tree origin/main supabase/migrations_vertical/`
  AND the prod ledger `private.vertical_migration` (prod frontier was 0194 as of 2026-07-24 —
  verify, don't trust). Use a FRESH kind-id block, `ON CONFLICT (id) DO NOTHING`. If code on a
  required write path needs a kind the migration adds, the migration must be applied WITH the
  merge or `lookupKindId` throws in prod.
- Do all verification in the PACHECO LAW tenant against prod. Not the sandbox tenant — the
  founder does not use it, and work proven only in sandbox is not considered proven here.
  Pacheco Law is the founder's own firm and its client data is test/demo data. Resolve the
  Pacheco tenant id fresh at the start (slug `pacheco`; it is NOT the `0000...0001` tenant,
  which was renamed "Dev Firm" during firm provisioning) — do not hardcode a remembered id.
- Because you are working in the live firm: clean up after yourself. Fixture matters,
  clients, invoices and envelopes you create for a walkthrough get archived/closed when
  you're done, through the action layer. Substrate tables are trigger-protected against
  raw DELETE for every role, so archive/close is the only path — never attempt a hard delete.
- Verify claims against the live DB or a real build, never from prose. Say plainly if
  something is unverified.
- Per CLAUDE.md's "Shipping new functionality" rule: if your work adds something the AI
  assistant or service builder should know about and you don't wire it, append a dated
  bullet to docs/design/assistant-actions/INVENTORY.md §6.
- Ask before inventing a new UI pattern. Two standing principles apply to everything:
  (a) document/template/review/e-sign/workflow/intake editing each belong in ONE reusable
  pop-out modal reused everywhere, never rebuilt per page; (b) universal AI rules belong in
  settings, not inline in per-service prompt boxes.
```

---

## 1. SB-FIX-1 — service-builder authoring correctness

*Four independent defects in the guided build, all found by an attorney building a real
multi-member LLC service. No new subsystems — this is correctness and polish on the
existing wizard.*

```
Task: SB-FIX-1 — fix four defects in the conversational service builder.

Read docs/diagnostics/SERVICE-BUILDER-AUDIT.md first; it is the repo map for the builder.
The authoritative prompt layer is the skill verticals/legal/skills/firm-admin/build-service.md
— it is SEEDED INTO THE DATABASE as a row, so editing the .md does nothing in prod until
`pnpm seed:skills` runs. Never re-add prompt copies inline in assistantChat.ts; the skill wins.

(1) WIZARD LOSES ITS PLACE. Repro: build a service, approve the billing/cost step, then go
back and ask for a change to the intake questionnaire. The builder generates a new
questionnaire proposal; after the attorney approves it, the flow does not resume where it
should. Reproduce it first, then fix the step/resume state tracking. Likely surfaces:
verticals/legal/src/api/buildBrief.ts (the BUILD BRIEF is derived fresh each turn),
apps/legal-demo/lib/buildHistoryContent.ts, and the approval-continuation queue in
assistantChat.ts. Do not guess — get a real reproduction before changing anything.

(2) TEMPLATE / QUESTIONNAIRE DRIFT. Adding or changing an intake field does not add the
matching merge token to the service's document template; the two silently diverge. Decide
where the sync belongs (propose_template / propose_service / templateAuthoring.ts) and make
a questionnaire edit propagate to the template. Respect the existing token classification in
api/tokenClasses.ts — SYSTEM tokens must never become client questions.

(3) JURISDICTION MUST ALWAYS BE ON INTAKE. Today the builder only raises governing
jurisdiction as an optional fix-it suggestion at Review & publish when it happens to notice a
template is jurisdiction-sensitive; otherwise the service silently falls back to the firm
default (NC) for every client. `governing_jurisdiction` already exists as a reusable
CLIENT_SOURCED_SLOT (tokenClasses.ts, intakeFieldLibrary.ts). Make the playbook always
include it by default rather than treating it as a conditional judgment call.

(4) SUBTLE RESTART/QUIT. There is no graceful way out of a stuck or unwanted build. Add an
understated control to abandon or restart the wizard — in the spirit of QuestionBatch's quiet
←Back, not a loud Cancel button. Propose the design and get sign-off before building it; the
constraint "should be subtle" is the whole requirement.

Done when: (1) has a written reproduction and a fix proven against it; (2) and (3) are proven
by building a service end-to-end in the PACHECO LAW tenant and showing the template gained the
token and intake asked for jurisdiction; (4) is signed off. Reseed skills after any
build-service.md edit and confirm the live DB row changed, not just the file. Leave the
fixture service disabled/archived when you're done.
```

---

## 2. MULTI-PARTY-1 — variable-count parties, end to end

*The single biggest functional gap. A service that involves N people can't capture them,
so nothing downstream (contacts, signers, signature fields) can work either.*

```
Task: MULTI-PARTY-1 — make services that involve multiple parties actually work.

Problem, from a real attorney build: a multi-member LLC operating-agreement service captured
only the primary client. No intake questions for the other members, no contacts created, and
consequently nothing to sign with. The builder then surfaced its own limitation to the
attorney ("I can't pre-build a fixed signature block per member when the count varies") and
offered only weak fallbacks. That is a gap, not an acceptable design.

Build three linked things:

(1) INTAKE CAPTURES N PARTIES. When a service can involve multiple members/parties/signers
(multi-member LLC, partnership, multi-party agreement), the builder should propose repeating
per-person intake fields — name, email, role, whatever the service needs. Decide how a
"repeating group" is expressed in the existing questionnaire schema and whether that needs a
new field type; prefer extending what exists over inventing a parallel concept.

(2) CAPTURED PEOPLE BECOME REAL MATTER CONTACTS. They must land as first-class contacts
linked to the matter, not merge-field strings. `legal.matter.link_contact` already exists
(many-to-many contact↔matter) — reuse it rather than inventing storage. Follow the existing
contact model so these people show up on the CRM record like any other contact.

(3) SIGNATURE FIELDS SCALE TO THE PARTY COUNT. Signature blocks must be generated per actual
signer at prepare/send time rather than baked statically into the template body. Before
designing this, read what already exists: #496 gave per-role e-sign field bindings
(verticals/legal/src/esign/fields.ts, api/esignPrefill.ts, components/templates/
TemplateEsignPanel.tsx) and #502 shipped open-ended signer chains (esign.add_signer,
handlers/esign.ts) — the machinery for N signers at send time may largely exist. The likely
shape is expanding one "Member" role into N concrete signature requests and field sets from
the matter's linked contacts. Verify that against the code before committing to it, and
present the tradeoffs if there's a real fork.

Prove it in the PACHECO LAW tenant: build a multi-member service, run a matter through intake
with 3 members, and show 3 contacts on the matter and 3 signature blocks on the prepared
document. Archive the fixture matter and contacts afterwards. Add the capability to
verticals/legal/demo/seed-capabilities.ts if this introduces one. Log anything left unwired
for chat to INVENTORY.md §6.
```

---

## 3. ESIGN-STEP-1 — e-sign as a real workflow step

*Depends on MULTI-PARTY-1 for auto-inferred signers; the modal itself can be built without it.*

```
Task: ESIGN-STEP-1 — make the workflow's e-sign step a real, in-place capability.

Today a workflow step labelled "Members sign, then attorney countersigns / Esign · automatic"
is a dead end. Asked "where do I add the signature spots?", the assistant correctly sent the
attorney AWAY to a separate Documents→Recipients→Fields→Review&send composer page, where the
document must be re-selected and every recipient re-entered by hand. The step itself does
nothing.

Build:

(1) An e-sign capability that opens the EXISTING composer (EsignComposer — do not build a
second one) as a POP-OUT MODAL invoked from the workflow step, pre-wired with the matter's
already-linked contacts as candidate recipients and the already-approved document loaded. The
`esignature` capability is currently contracted-but-unbuilt in the capability registry and
deliberately raises a visible error rather than simulating; this task is to build it. Read
verticals/legal/src/api/capabilityRuntime.ts, lifecycle/autoRun.ts (scheduleCapabilityAutoRun)
and demo/seed-capabilities.ts for how an invocable capability is registered and dispatched.

(2) The auto-advance chain the attorney actually wants:
      document generated
    → attorney approves, auto-sends to client
    → client approves, matter auto-advances to the e-sign step
    → signers added (automatically from the matter's contacts where possible, otherwise the
      attorney adds them in the modal) and sent for signature.
Parts of this exist — draft.approve already advances, handlers/clientDelivery.ts already
advances client-gated stages from the client's own action. Wire the missing links; don't
rebuild what advances already.

Known hazard to handle, not discover the hard way: capability auto-run is synchronous inside
the triggering request. Any route that can now trigger an e-sign auto-run must carry a
maxDuration large enough, or move the work onto the durable worker (the requestDocumentReview
pattern). The invoke route already sets 300.

This is also the FIRST exemplar of the standing "one reusable pop-out modal" principle — build
the modal shell so the next surface can reuse it verbatim, and note in the PR how it should be
reused. Prove the whole chain end to end in the PACHECO LAW tenant with a real envelope, then
void/close the fixture envelope and archive the matter.
```

---

## 4. DOC-RENDER-1 — template rendering fidelity

*Standalone investigation-then-fix. Independent of everything else.*

```
Task: DOC-RENDER-1 — fix template rendering across the platform.

Two problems, likely related but possibly separate — investigate before assuming.

(1) RAW MARKUP LEAK. A generated Operating Agreement template rendered literal HTML as
visible body text in the builder's preview card, e.g.
    <p style="textalign: center;"<strongOPERATING AGREEMENT OF <span datavariable="companyname"
    class="tplvarchip"
appearing verbatim in the document pane, interleaved with correctly-rendered merge chips.
Note the source markup itself is malformed — a missing `>` after the style attribute, an
unclosed `<strong`, and attribute names with their hyphens stripped (`textalign`,
`datavariable` — should be `text-align`, `data-variable`). So there are plausibly TWO bugs:
generation emitting broken HTML into the template body, and the preview renderer dumping raw
text instead of catching it. Find out which, and fix both if both are real.

(2) RENDERING FIDELITY GENERALLY. The attorney's broader complaint: "almost everywhere that
templates are rendered (including the service builder) are very ugly and not true proportions
or formatting." Even with well-formed markup, document surfaces don't look like documents.
Audit every place a template or generated document renders — builder preview card, template
editor, attorney document views, client/portal views, e-sign preview — and bring them to a
consistent, correct document presentation (page proportions, margins, typography, spacing).

Start with (1) — it's a concrete bug with a concrete repro and will point you at the render
path that (2) then needs to fix everywhere. Beware: there is a deliberate security boundary
where the documentHtml sanitizer strips <img>, which is why drawn/uploaded signatures don't
render on display surfaces. Do not weaken the sanitizer as a shortcut to prettier output.

Show before/after on at least three distinct render surfaces.
```

---

## 5. MODAL-STD-1 — standardize every pop-out modal

*Run after ESIGN-STEP-1 has built the exemplar.*

```
Task: MODAL-STD-1 — audit and standardize the platform's pop-out modals.

Standing principle from the founder: document approval, document editing, document review,
template editing, e-sign, workflow editing, and intake-form editing should EACH be one
reusable pop-out modal component, invoked identically from any page, differing only in the
context passed at open time (matter id, document id, contacts). The explicit anti-goal:
"not have to build 5 different template editors or doc editors in 5 different places."

Phase 1 — AUDIT, one concern at a time. For each of the seven concerns above, enumerate every
page/surface that opens something for it, and record whether it uses a shared component or a
bespoke one. Write the findings into docs/design/ as a table. Known starting points: the
document editor (#466), the template editor + e-sign field/signer rail (#496), the engagement
letter template library (#487), EsignComposer (#400/#402 and the modal built by ESIGN-STEP-1),
the step editor (#311 — its own commit message says "both manual step editors", which suggests
there are already two of something that should be one), and the workflow runner (#317).

Phase 2 — MIGRATE, in priority order, one PR per concern. Do not attempt all seven in one PR.
Report the audit table and get the migration order signed off before writing code.

This overlaps heavily with the separate full-UI-cleanup walkthrough; check whether that has
run yet and reuse its findings instead of re-deriving them.
```

---

## 6. CONTEXT-SETTINGS-1 — prompt settings + per-user/tenant context files

*Independent. Ties into the existing AI-context program.*

```
Task: CONTEXT-SETTINGS-1 — build the Context Settings tab.

Problem: the per-service drafting prompt box currently shows the UNIVERSAL base guidance
inline — "never invent a value, leave the {{token}} in place", "never write draft banners
into the document", "output the final document only" — mixed into the same textarea meant for
the attorney's own service-specific instructions. Universal rules are exposed where they can
be accidentally edited or deleted, and it's impossible to see what's actually custom.

Build a Context Settings tab containing:

(1) PROMPT SETTINGS, one section per AI capability — document generation, review, and any
other action the AI takes — holding firm-wide default instructions. Strip the universal base
guidance out of the per-service prompt box; it should still be applied, concatenated
server-side, just not shown as attorney-editable boilerplate. The per-service box then holds
ONLY service-specific instruction. Find where the base guidance is injected today (likely
templateAuthoring.ts / bundledPrompts.ts) and reconcile.

(2) A PERSISTENT CONTEXT .md PER USER AND PER TENANT — one for each individual attorney/staff
member, one for the firm, in the spirit of Claude Code's own user-level and project-level
memory files. Design the storage and injection model; this belongs inside the existing unified
AI context program rather than as a standalone feature, so check what that program already
established before adding a parallel mechanism.

(3) ALL OF IT CHAT-EDITABLE. Saying "every document we generate should be professional and
well formatted" in chat should update the Document Generation settings; "every letter should
have my letterhead" likewise. "This is a contract review for medical employee agreements, I
usually look out for these three things" should update THAT SERVICE, not the global default.
The assistant needs to route an instruction to the right scope — global capability, this
service, this user's file, or the firm's file — and say which it wrote to.

The scope-routing in (3) is the hard part and the whole point; don't ship (1) and (2) with a
settings page the assistant can't reach.
```

---

## 7. CHATBOT-CATCHUP-1 — teach the assistant what shipped

*Run LAST, after the sessions above merge, so it covers their output too.*

```
Task: CHATBOT-CATCHUP-1 — close the chatbot/builder awareness backlog.

docs/design/assistant-actions/INVENTORY.md is the standing census: which action-layer
operations exist, which the assistant can actually trigger, and what's stale. Its §6 is an
append-only log of gaps opened by feature PRs. Work that log, then sweep for anything newer.

Known entries as of 2026-07-24, verify each is still open before working it:
- Attorney Task Queue (#489/#491) — legal.attorney.task_queue has no ClientTool and no
  mention in skillContext.ts/assistantPrompt.ts. The assistant cannot tell an attorney what's
  waiting for them, unlike its get_attention_feed sibling.
- Engagement Letter Library (#487/#488/#493) — legal.firm.engagement_letters.* has no
  attorney-chat wrapper.
- Bilingual services (#490) — `offer_spanish` is absent from propose_service's input schema,
  so the AI cannot set it from conversation, and it isn't modelled in seed-capabilities.ts.
- Per-role e-sign field bindings (#496) — propose_template's esignConfig.roles[] schema sets
  `additionalProperties: false` with no `fields` property, so the AI literally cannot construct
  the shape the backend now round-trips.
- Client mailing/business address + preferred contact (#495) — never added to
  MERGE_SLOT_FIELDS, so no {{client_mailing_address}} token exists. The comment at
  apps/legal-demo/app/attorney/templates/page.tsx:90-93 claiming client_address is
  "deliberately absent" is now stale and should be corrected.
- "E-sign a PDF with no matter" — esignLaunchTools.ts still only resolves matter draft
  versions; no blank/document mode was added.

Remember that `additionalProperties: false` on a ClientTool input schema means an undocumented
field is UNREACHABLE by the model, not merely undocumented — that is the recurring root cause
in this backlog.

Also sweep whatever SB-FIX-1, MULTI-PARTY-1, ESIGN-STEP-1 and CONTEXT-SETTINGS-1 shipped and
wire the assistant to it. Close out the §6 entries you fix, and fold anything that has grown
into a real body of work back into the §3 gap map.

Prefer many small additive ClientTools over one large refactor; assistantChat.ts is a hot file
that conflicts constantly with parallel work.
```

---

## Not code prompts

Four open items that shouldn't be handed to an autonomous session:

- **Billing go-live.** Stripe Connect is built and merged but test-mode only. Going live is
  operational, not code: enable Connect on the platform account, paste real keys at
  `/admin → Payments`, register the webhook, and confirm on a real invoice. Verify the current
  state of `/admin → Payments` fresh before assuming any of it is already done — the memory on
  this is a month old. Also outstanding: prod migration-ledger drift noted at the time
  (0107/0108/0110/0111/0112 on main but possibly not applied to prod) needs a careful
  per-migration reconciliation.
- **Full UI cleanup walkthrough** — booking link → client portal → attorney platform,
  screen by screen. This is Joe driving with Claude documenting; log findings, don't fix
  silently while walking.
- **Full functionality audit** — same shape, but testing whether things actually work end to
  end rather than how they look.
- **Custom skills library in the platform.** Requested but undesigned: an attorney-facing
  library for browsing and authoring the assistant's skills, in-product. A runtime skill system
  already exists (skills seeded as substrate rows, edited via legal.skill.update) and a private
  dev repo `exsto-skills` exists, but neither is an attorney-facing UI. Needs a design
  conversation and sign-off before any session builds it — likely belongs alongside the Context
  Settings tab from prompt 6.
```
