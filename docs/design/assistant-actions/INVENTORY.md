# ASSISTANT-ACTIONS — Inventory (exsto-law)

(Coverage census for the in-app AI assistant chat. Source of truth for the next
implementation wave: which action-layer operations the platform supports, which the
attorney chatbot can actually trigger, which chat tool paths are stale or dead-end, and
the template for closing a gap. Docs-only; no code changes. Audited on `origin/main`
@ `c251434` — "ESIGN-UNIFY-1 ES-5a: attorney entry points → unified composer".)

Method (same discipline as `docs/design/esign-unify/DESIGN.md` — read the code, don't
guess). Op census parsed from every `name:`/`mode:` pair across
`verticals/legal/src/mcp/tools/*.ts` (the MCP adapter is the canonical enumeration of the
`@exsto/legal` action/query surface — each tool wraps an action-layer function or query).
Chat coverage cross-referenced against the ClientTools actually assembled in
`buildAttorneyClientTools()` (`verticals/legal/src/api/assistantChat.ts:602-712`) and
`buildClientPortalTools()` (`verticals/legal/src/api/clientAssistantChat.ts:107`). Where a
verdict rests on an inference I couldn't fully trace end-to-end, it's marked **(unverified)**.

## 0. Summary stats

- **Distinct action-layer operations (MCP tools): 337** — **~174 write/act**, ~157 read/query,
  plus a handful whose `mode` sits outside the parse window (all write-ish: `esign.send_file`,
  `esign.send_for_signature`, `fee.waive`, `email.prompt.update`, `service.review.update`,
  `client.brief.generate`). Of the write ops, **11 are platform-admin** (`admin.*`, never
  attorney-chat scope) and a further block is **client-portal-actor** (`legal.client.*`,
  `legal.esign.portal.*`, `questionnaire.submit`, `intake.something_else`, `booking.submit`).
  That leaves roughly **130 attorney-actionable write ops**.
- **Attorney chat ClientTools: 24** — 10 always/scope-gated + 14 gated behind the
  `LEGAL_BUILD_WIZARD` flag (`buildWizardEnabled()`, `lifecycle/flags.ts`). Only **2 write to the
  substrate directly** (`log_feedback`, `request_capability`); the rest are read-context,
  capture-for-approval, or launch-a-UI tools.
- **Client-portal chat ClientTools: 9** — 8 read + 1 capture (`prepare_request`). Read-only by
  design; no stale paths found.
- **Chat coverage of attorney write ops:**
  - **Covered (reachable from attorney chat, directly / via propose→approve / via launch): ~13
    ops** across feedback, capability-gap, build-wizard authoring (service, questionnaire,
    template, cost, enable, kind, workflow), client email, artifact edit, and e-sign launch.
  - **Covered-but-STALE: 1** — `prepare_envelope` (opens the delete-target `PrepareSignature`
    wizard, not the new `EsignComposer`; see §4).
  - **NOT covered: ~117 attorney write ops** — the entire CRUD/act surface for matters, clients,
    contacts, companies, billing/invoicing/trust/time/expense, tasks, calendar/booking/meetings,
    firm settings/rates/signatures, notes, users/access, integrations, drafts lifecycle
    (approve/reject/revise), and e-sign lifecycle (void/resend).
- **E8 dead-ends: 1 confirmed** (`prepare_envelope` "eSign a PDF for me" has no chat path and
  the tool points at a component slated for deletion). No silent-no-op ClientTool handlers found
  — the propose/capture tools all return honest "nothing was done / attorney is the gate" strings.

## 1. Op census

Write/act operations only (reads omitted except where they back a chat tool — the full read
surface is ~157 tools and is not the subject of act-coverage). Grouped by domain; one line each,
verbatim-sourced from each tool's `description`. `[C]` = reachable from attorney chat today,
`[S]` = reachable but stale, `[—]` = no chat path. Admin/portal-actor ops flagged as such.

### Matters (`legal.matter.*`) — 13 write ops, `[—]` all
- `matter.open` — open a matter manually (attorney-initiated, no booked consult). `[—]`
- `matter.advance` — advance a matter one step through its bound workflow lifecycle (ADR 0045). `[—]`
- `matter.set_workflow` — customize one matter's workflow graph. `[—]`
- `matter.set_owner` — set/transfer the owning attorney. `[—]`
- `matter.grant_access` — replace the set of attorneys granted send access. `[—]`
- `matter.link_contact` — connect a contact to a matter (many-to-many). `[—]`
- `matter.set_company` — link a matter to its company. `[—]`
- `matter.set_governing_law` — set/clear a matter's governing jurisdiction. `[—]`
- `matter.add_fee` — add a service/document fee by hand (billable). `[—]`
- `matter.void_fee` — void an unbilled fee. `[—]`
- `matter.message_post` — post a reply to the client on a matter portal thread. `[—]`
- `matter.brief.generate` / `matter.brief.request` — (re)generate the Matter Brief (sync / worker). `[—]` (chat has read-only `get_brief`, not generate)

### Drafts (`legal.draft.*`) — 6 write ops, `[—]` all
- `draft.generate` — enqueue async drafting against the matter. `[—]` (chat uses `produce_document`, an ad-hoc card that does NOT invoke this pipeline)
- `draft.edit` — attorney inline edit → new version (append-only). `[—]` (chat `open_artifact_editor` launches an editor; the write is the editor's, not a chat tool)
- `draft.approve` / `draft.reject` / `draft.request_revision` — draft lifecycle. `[—]`
- `draft.revise` — AI revision of a version under attorney direction. `[—]`

### E-sign, attorney side (`legal.esign.*`) — `[S]`/`[—]`
- `esign.send_for_signature` — send an approved document for e-signature. `[S]` via `prepare_envelope` (opens stale wizard — §4)
- `esign.send_file` — send an uploaded PDF for e-signature. `[—]` (no chat path — the "eSign a PDF for me" dead-end, §4)
- `esign.void` — void an active envelope. `[—]`
- `esign.resend` — re-send the signing link/nudge to the current signer. `[—]`
- (`esign.portal.load/sign/decline` are client-actor, portal chat scope.)

### Tasks (`legal.task.*`) — 6 write ops, `[—]` all
- `task.create` / `task.update` / `task.archive` — matter task CRUD. `[—]`
- `task.attach_document` — turn a task into a signature task. `[—]`
- `task.link_envelope` — record the envelope a signature task was sent under. `[—]`
- `task.review` — review executed copy and complete a signature task. `[—]`

### Clients / contacts / companies (CRM) — `[—]` all
- `client.create` / `client.update` — client (parent) CRUD + billing settings. `[—]`
- `company.create` / `company.update` — CRM company CRUD. `[—]`
- `contact.set_company` — link contact→company. `[—]`
- `contact.invite_to_portal` / `contact.revoke_portal_access` — portal access grant/revoke. `[—]`
- `otherAttorney.create/update`, `referralPartner.create/update` — non-client contact records. `[—]`

### Billing / invoicing / trust / time / expense — `[—]` all
- `invoice.issue` / `invoice.send` / `invoice.pay` — invoice lifecycle. `[—]`
- `time.log` — log billable time against a matter. `[—]`
- `expense.record` — record a matter expense. `[—]`
- `fee.waive` — waive a fee (billed at $0, provenance kept). `[—]`
- `trust.deposit` / `trust.disburse` / `trust.refund` / `trust.apply_to_invoice` — IOLTA trust ops. `[—]`
- `billing.dismiss_payment_report` — dismiss an unverifiable client payment report. `[—]`

### Calendar / booking / meetings — `[—]` all
- `booking.create_for_matter` / `booking.cancel` / `booking.reschedule` / `booking.add_attendees` / `booking.categorize` — consultation booking (attorney side). `[—]`
- `meeting.create` / `meeting.assign` / `meeting.unassign` / `meeting.cancel` / `meeting.reschedule` / `meeting.reconcile_all` — Google-synced calendar events. `[—]`
- `calendar.categories.set` — replace the firm calendar palette. `[—]`
- `call.assign` / `call.record_manual` — attach/record consultation calls. `[—]`

### Firm settings / rates / signatures — `[—]` all (the long-standing 2026-07-07 gap, still open)
- `settings.update` — update firm-level settings. `[—]`
- `booking_rules.update` — update firm booking rules. `[—]`
- `firm.set_default_rate` — set the firm-wide default hourly rate. `[—]`
- `rates.set_client` / `rates.set_service` — client/service rate overrides. `[—]`
- `settings.signature.set` / `settings.attorney_signature.set` — firm/attorney email signature. `[—]`
- `firm.set_invoice_template` / `firm.set_payment_methods` / `firm.payment_refresh` / `firm.payment_disconnect` — invoicing + Stripe config. `[—]`
- `email.prompt.update` — save the firm email-drafting prompt / house-voice doctrine. `[—]`
- `service.review.update` — save a service's review config. `[—]`

### Notes / saved views / integrations — `[—]` all
- `note.create` / `note.update` / `note.retire` — matter/client notes. `[—]`
- `savedview.create` / `savedview.update` / `savedview.delete` — saved list filters. `[—]`
- `integration.connect` / `integration.disconnect` — API-key integrations. `[—]`
- `google.disconnect`, `granola.import` / `granola.disconnect` — provider connections. `[—]`
- `notifications.mark_seen` — clear the attorney notification badge. `[—]`

### Email (attorney→client) — `[C]` (partial)
- `mail.compose` / `mail.reply` — send to a known client contact via Gmail + record. `[C]` via `compose_email` (capture → firm composer → attorney sends; the tool writes nothing)
- `email.draft` — AI-compose an email from matter facts. `[C]` (same composer surface)
- `email.send_draft_link` — email the client a secure document-view link. `[—]`

### Services / templates / questionnaires / workflows (build-wizard authoring) — `[C]` (flag-gated)
- `service.create` / `service.update` / `service.clone` / `service.retire` — service offering CRUD. `[C]` via `propose_service` (propose→approve; flag-gated)
- `service.set_active` — enable/disable a service (enable gated on completeness). `[C]` via `propose_enable`
- `service.cost.set` — set a service's fee model. `[C]` via `propose_cost`
- `service.lifecycle.set` — author a service's workflow graph. `[C]` via `propose_workflow` (always registered)
- `service.questionnaire.update`, `service.prompt.update`, `service.template.update`, `service.template.esign.update` — service config. `[C]`/`[—]` (some reachable via the wizard's compose steps; the esign template config has no dedicated propose tool — **(unverified)** whether the wizard emits it)
- `questionnaire_template.create/update/archive/set_templates` — reusable questionnaire library. `[C]` via `propose_questionnaire`
- `question_template.create/update/archive` — reusable library questions. `[—]`
- `template.create/update/archive/retire`, `template.ai_draft`, `template.ai_enhance` — standalone template library. `[C]` via `propose_template` (create/update); the `ai_*` server-side authoring ops have no chat tool `[—]`
- `workflow_step_template.create/update/archive` — reusable workflow-step library. `[—]`
- `skill.create/update/archive` — the AI skill library. `[—]`
- (new data kinds — entity/attribute/event/relationship) — `[C]` via `propose_kind` (flag-gated)

### Feedback / capability / research / assistant-meta — `[C]` (partial)
- `assistant.feedback_submit` — file a beta-feedback item. `[C]` via `log_feedback` (**direct write**)
- capability-library request (`requestCapability`, no dedicated MCP tool name in the census — action-layer function) — file a Tier-3 gap. `[C]` via `request_capability` (**direct write**, flag-gated)
- `research.ask` — Perplexity research scoped to a matter. `[—]` (the attorney chat has its own web-search branch; this MCP op is not a ClientTool)
- `attention.feed` (read) — ranked "what's most pressing" feed. `[C]` (read) via `get_attention_feed`
- `assistant.save_reply` — save an assistant reply as a matter draft. `[—]` (a UI action, not a self-callable chat tool)
- `document.review.run` — enqueue an AI review of an uploaded document. `[—]`
- `transcript.extract` — distill a consultation transcript into notes/facts. `[—]`

### Users / access / admin — `[—]` all
- `user.invite` / `user.assign_role` / `user.deactivate` — firm user management. `[—]`
- `admin.*` (11 ops: tenant bootstrap/status, module enable/disable, access, payments keys, promote) — platform-admin scope, **out of attorney-chat scope by design**. `[—]`

## 2. Chat coverage — the ClientTool registry

### 2.1 Attorney chat (`buildAttorneyClientTools`, assistantChat.ts:602)

Always registered (10):

| Tool | Kind | Backs op | Verdict |
|---|---|---|---|
| `log_feedback` | **direct write** | `assistant.feedback_submit` | Covered |
| `produce_document` | capture (card) | — (ad-hoc doc; NOT `draft.generate`) | Covered (no substrate op) |
| `load_skill` | read | skill catalog | Covered (read) |
| `get_workflow_context` | read | workflow catalog + service reads | Covered (read) |
| `propose_workflow` | capture→approve | `service.lifecycle.set` | Covered |
| `open_artifact_editor` | launch UI | (editor performs `draft.edit`/`template.update`) | Covered (launch) |
| `get_attention_feed` | read | `attention.feed` | Covered (read) |
| `compose_email` | capture→composer | `mail.compose` / `email.draft` | Covered (launch) |
| `get_brief` | read (scoped) | `matter.brief.get` | Covered (read) |
| `prepare_envelope` | launch UI (matter-scoped) | `esign.send_for_signature` | **Covered-but-STALE** (§4) |

Flag-gated behind `LEGAL_BUILD_WIZARD` (14): `get_service_context`, `propose_service`,
`get_questionnaire_context`, `propose_questionnaire`, `get_template_context`, `propose_template`,
`get_service_completeness`, `propose_cost`, `propose_enable`, `ask_build_question`,
`get_capability_context`, `request_capability` (**direct write**), `get_kind_context`,
`propose_kind`. With the flag off these are not registered and the chatbot is byte-for-byte the
non-wizard bot — so all build-wizard "coverage" above is **conditional on the flag**.

The `propose_*` tools are **capture-only**: `run()` pushes the proposal onto a per-turn capture
array; the caller surfaces an approval card; the substrate write happens only when the attorney
approves (e.g. `propose_enable` → `service.set_active`, re-checked server-side on approve —
costEnableTools.ts:196). This is the propose→approve discipline (§4). The two exceptions that
write on call are `log_feedback` (`submitAssistantFeedback`) and `request_capability`
(`requestCapability`) — both through the action layer, both returning a reference id.

### 2.2 Client-portal chat (`buildClientPortalTools`, clientAssistantChat.ts:107)

Nine tools, all read except one: `get_my_matters`, `get_matter_status`, `get_my_documents`,
`get_my_billing`, `get_my_todos`, `get_messages`, `get_bookable_services`, `get_availability`,
`get_scheduling_fee` (reads), plus `prepare_request` (capture → the portal request UI). No writes,
no stale references. Out of scope for the act-coverage waves below.

### 2.3 The coverage gap in one sentence

The attorney chatbot can **answer** about almost anything (rich read/context tools + the attention
feed + web search) and can **author services/templates** (behind a flag) and **draft an email or
open an e-sign/edit UI** — but it **cannot perform the day-to-day operational writes** a firm runs
on: nothing in matters, CRM, billing/trust/time, tasks, calendar/booking, firm settings/rates, or
notes is reachable. ~117 attorney write ops have no chat path.

## 3. Wave-1 / Wave-2 gap map

Grouped from the `[—]` ops above. Wave 1 = high-value, low-effort, safe for chat to trigger
(idempotent-ish, low blast radius, or already fronted by a clean action-layer function that just
needs a ClientTool wrapper — the 2026-07-07 pattern). Wave 2 = needs confirmation UX, is
destructive/irreversible/financial, or needs more design.

### Wave 1 — wrap-and-go (a ClientTool over an existing action fn; §5 template)

1. **Firm settings + rates + signatures** — the original 2026-07-07 gap, still open. Wrap
   `settings.update`, `booking_rules.update`, `firm.set_default_rate`, `rates.set_client`,
   `rates.set_service`, `settings.signature.set` / `attorney_signature.set`. Low risk (firm-scoped
   config, fully reversible, admin already edits them in `/admin`), high "the platform can do this
   but the bot can't" payoff. Each is a single-purpose action fn.
2. **Time + expense capture** — `time.log`, `expense.record`. Extremely common, additive,
   append-only, matter-scoped (rides the existing `scoped` guard). "Log 0.5h reviewing the lease."
3. **Notes** — `note.create`, `note.update`, `note.retire`. Additive, low blast radius,
   matter/client scoped.
4. **Tasks** — `task.create`, `task.update`. Additive, matter-scoped, no money. (`task.archive`,
   `task.review`, signature-task wiring → Wave 2.)
5. **CRM links** — `contact.set_company`, `matter.link_contact`, `matter.set_company`,
   `matter.set_governing_law`. Pure relationship writes, reversible, no money.
6. **Notifications** — `notifications.mark_seen`. Trivial, pairs naturally with `get_attention_feed`
   ("clear my notifications").
7. **Saved views** — `savedview.create/update/delete`. Low stakes, personal.

### Wave 2 — needs confirmation UX or more design

1. **Money movement** — `invoice.issue/send/pay`, `matter.add_fee`/`void_fee`, `fee.waive`, all
   `trust.*` (IOLTA — regulated, irreversible-in-spirit). Require an explicit confirm card (mirror
   the propose→approve pattern, not a bare tool call).
2. **Matter lifecycle** — `matter.open`, `matter.advance`, `matter.set_workflow`, `matter.set_owner`,
   `matter.grant_access`. `advance` moves state through a workflow graph — needs the runner's
   confirmation semantics, not a fire-and-forget tool.
3. **Draft + e-sign lifecycle** — `draft.approve/reject/request_revision`, `esign.void`,
   `esign.resend`, `esign.send_file` (the "eSign a PDF" path, §4). Approval/void are consequential
   and client-visible; these want a review card. (`draft.generate` is a heavier design question —
   it enqueues the reasoning-trace drafting pipeline; `produce_document` is deliberately the light
   path.)
4. **Calendar / booking / meetings** — `booking.*`, `meeting.*`, `call.*`. Each touches Google
   Calendar (external side-effects, invites to real people) — needs preview/confirm before firing
   `sendUpdates: all`.
5. **Client/company creation + portal access** — `client.create`, `company.create`,
   `contact.invite_to_portal`, `contact.revoke_portal_access`. Creation is fine but duplicate-risk;
   portal invite/revoke emails real people — confirm UX.
6. **Users / access / integrations** — `user.invite/assign_role/deactivate`,
   `integration.connect/disconnect`. Security-sensitive; likely stay admin-UI only or need a strong
   confirm.
7. **Document review / transcript** — `document.review.run`, `transcript.extract`. Enqueue AI work;
   fine to wrap but lower demand than Wave 1.

## 4. E8 dead-end audit

"E8" (per the ITEM 10 e-sign walk in `docs/design/esign-unify/DESIGN.md` §8) = a chat tool that
gets called but produces no visible effect, dead-ends, or points at removed code — the discipline
being propose→approve and never letting the bot claim something is "live" that isn't.

### 4.1 CONFIRMED — `prepare_envelope` is stale and partially dead-ends

`verticals/legal/src/api/esignLaunchTools.ts` and its frontend consumer are out of step with the
ESIGN-UNIFY-1 cutover that this same commit (`c251434`, "ES-5a") began:

- The tool's own header comment and `description` still say it opens **"the firm's REAL 4-step
  prepare wizard (PrepareSignature)"** (esignLaunchTools.ts:4, :24). Per DESIGN §11,
  `PrepareSignature.tsx` and `NewEnvelopeWizard.tsx` are **delete targets** — replaced by
  `components/esign/EsignComposer.tsx` (which now exists — the full `components/esign/*` family is
  present).
- The frontend still honors that: `UnifiedAssistantChat.tsx:20` imports `PrepareSignature`, and
  the envelope-prepare launch renders **`<PrepareSignature …>`** (UnifiedAssistantChat.tsx:3401),
  NOT `EsignComposer`. Meanwhile the page entry points WERE cut over — `app/attorney/esign/new/page.tsx:2`
  notes "NewEnvelopeWizard deleted with it; old links land on the ONE composer." So the chat launch
  is now the odd one out, still fronting the founder-rejected anchor-tag wizard.
- **Not yet a hard break** (both old and new components still exist in the tree — the §11 deletion
  hasn't landed), but it is stale, and when ES-5's deletion PR lands, this chat path breaks unless
  rewired. **Also** the two other attorney entry points still on the old component — `app/attorney/sign/prepare/[versionId]/page.tsx:26`
  and the signature-task page — will break the same way; worth folding into the same fix.
- **The dead-end proper:** the DESIGN (§8) specified the descriptor gain `{ mode: 'document' |
  'blank' }` so **"eSign a PDF for me"** opens the blank/upload composer. It didn't. The current
  `EnvelopePrepareLaunch` has no `mode` field (esignLaunchTools.ts:15-20), and `run()` resolves
  **only matter documents** (`listMatterDraftVersions`, line 70) — the tool is also only registered
  when `input.matterEntityId` is set (assistantChat.ts:670). So an attorney with no matter context,
  or asking to e-sign an uploaded PDF, has **no chat path at all** — it dead-ends. This maps to
  `esign.send_file` being `[—]` in §1.

**Fix (for the wave):** re-point the launch at `EsignComposer` (descriptor → composer `source`,
add `mode`/upload support), delete the `PrepareSignature` import from `UnifiedAssistantChat.tsx`,
and refresh the tool comment/description to say "composer," not "PrepareSignature." Fold in the
two page consumers so the §11 deletion is safe.

### 4.2 No silent no-ops found in ClientTool handlers

Grepped every ClientTool builder (`compose_email`, `esign`/`editor` launch, `capability`,
`attention`, `brief`, `workflow`/`service`/`intake`/`cost`/`buildQuestion`/`kind` authoring,
`skill`) for `todo|fixme|not.?implemented|stub|no-?op|placeholder|coming soon`. No stub handlers.
Every tool either writes through the action layer, captures for an approval/edit card, or launches
a real UI — and each `run()` returns an honest string on the empty/failed path (e.g.
`compose_email`: "No email body was provided, so the composer was not opened."; `propose_enable`:
completeness is re-checked server-side on approve so an early proposal is rejected at the write).
The propose→approve discipline holds: no attorney-chat tool claims a live effect it didn't produce.
(One residual honesty risk lives in prose, not code: the stale `prepare_envelope` description still
tells the model it opens "the firm's REAL send-for-signature wizard" — true today, wrong the day
§11 lands.)

## 5. Implementation template — adding a ClientTool over an existing action-layer op

The clean, best-covered examples are `log_feedback` and `produce_document` (both in
assistantChat.ts) for the pattern shape, `compose_email` (`api/composeEmailTool.ts`) for a
capture→UI tool, and `request_capability` (`api/capabilityTools.ts`) for a **direct-write** tool.
A `ClientTool` is `{ definition, name, run }` (`adapters/claude.ts:358`).

**To wrap an existing action fn (e.g. `time.log`) as a direct-write chat tool:**

1. **New file** `verticals/legal/src/api/<domain>Tool.ts` (mirror `capabilityTools.ts`). Export a
   `build<Name>Tool(ctx: ActionContext, input: AssistantChatInput): ClientTool`. Explicit return
   type — lint requires it.
2. **Tool definition** — a `const <NAME>_TOOL_DEF = { name, description, input_schema }` object.
   The `description` carries the guardrails the model must obey (when to call, what NOT to invent,
   what the reply must say). `input_schema` is JSON-schema with `additionalProperties: false` and a
   minimal `required` set. Never let the model pass ids it could hallucinate — resolve by the
   attorney's words server-side (the `prepare_envelope` hint-matching pattern) or take them from
   `ctx`/`input`.
3. **`run(raw)`** — cast `raw` to the arg shape, trim/validate, and on missing input **return an
   honest string** ("… so nothing was logged.") rather than throwing. On the happy path call the
   existing `@exsto/legal` action fn (import from `../index.js`) — never a raw substrate write
   (hard rule 1) — and return a short confirmation with any reference id. The action fn already
   sets provenance/knowability/tenant; do not re-implement.
4. **Register it** in `buildAttorneyClientTools` (assistantChat.ts:629+). Choose the guard:
   unscoped (always), `scoped` (needs `matterEntityId || contactEntityId`, like `compose_email`),
   `matterEntityId`-only (like `prepare_envelope`), or `buildWizardEnabled()` (authoring tools).
   Put it near a peer of the same guard.
5. **Capture vs write.** If the op is consequential/financial (Wave 2), do NOT write in `run()` —
   push a proposal onto a capture array (add the field to `AttorneyTurnCapture`, assistantChat.ts
   ~:470-493) and surface an approval card in `UnifiedAssistantChat.tsx`, mirroring
   `propose_enable` → the Enable card → server-side re-check on approve. If it's Wave-1-safe,
   write directly like `log_feedback`.
6. **Prompt awareness** (optional) — if the model needs to know the tool exists in specific
   contexts, the system-prompt assembly is in `api/assistantPrompt.ts`; most tools rely on the
   `description` alone.
7. **Test** — add the tool to the dormancy/activation assertion (`buildAttorneyClientTools` is
   exported for exactly this — assistantChat.ts:599). Add the new test file to the **explicit
   `test:unit` list** (the ASSISTANT-ACTS-1 / MACHINE-COMMS gotcha — a new test file not on the
   list silently doesn't run). Cover: happy path calls the action fn, empty input returns the
   honest string, and (for capture tools) the proposal lands without a substrate write.
8. **Gate** — full local gate before push (`pnpm format && pnpm lint && pnpm typecheck && next
   build && test:unit`); `assistantChat.ts` is a hot file — keep the diff focused and rebase on
   `main` before pushing.

**File-touch checklist for one new tool:** `api/<domain>Tool.ts` (new) · `api/assistantChat.ts`
(register + capture type if propose) · `components/UnifiedAssistantChat.tsx` (only if it surfaces a
card/launch) · a new test file + the `test:unit` list · (no migration — these wrap ops that already
exist).

## 6. Newly opened gaps (append-only log)

Per the "Shipping new functionality" rule in root `CLAUDE.md`: append one dated bullet here when
a PR ships something the assistant/builder should plausibly know about but wiring it was deferred.
Don't rewrite this census to keep it current — just log the delta. A future sweep folds durable
entries into the gap map in §3 and marks closed ones fixed.

- **2026-07-21 (post-#457 audit, pre-2026-07-22 sweep):**
  - `prepare_envelope` → `PrepareSignature` staleness (§4.1): **FIXED.** `PrepareSignature.tsx`/
    `NewEnvelopeWizard.tsx` deleted; chat now opens `EsignComposer` (`UnifiedAssistantChat.tsx:20,3417`).
  - Attorney Task Queue (#489/#491): `attorneyTaskQueueTools.ts` (`legal.attorney.task_queue`) has
    no `ClientTool` in `buildAttorneyClientTools` and no mention in `skillContext.ts`/`assistantPrompt.ts`
    — the assistant can't tell an attorney what's in their queue, unlike its `get_attention_feed` sibling.
  - Engagement Letter Library (#487/#488/#493): `legal.firm.engagement_letters.*` (list/set_default/
    remove/import, `settingsTools.ts`) has no attorney-chat wrapper — same shape as the pre-existing
    firm-settings gap (§3 Wave 1 #1), now extended to this domain.
  - Bilingual docs (#490, `offer_spanish`): not in `propose_service`'s input schema
    (`serviceAuthoringTools.ts`) — the AI can't set it from conversation, only manually via the
    `ServiceEditorModal` proposal card. Not modeled in `seed-capabilities.ts` either.
  - eSign "upload a PDF, no matter" dead-end (§4.1, distinct from the fixed staleness above): still
    open. `esignLaunchTools.ts` still only resolves `listMatterDraftVersions`; no `mode: 'blank'|'document'`
    was added.
  - `legal.user.delete` / `.portal_list` / `.set_portal_user_type` (USERS-SPLIT-1 follow-on): new,
    unwired — consistent with the existing users/access Wave-2 call (security-sensitive, likely stays
    admin-UI only).

- **2026-07-22 (#494/#495/#496 sweep):**
  - ESIGN-FIELDS-1 (#496, per-role signer field bindings, drag-and-drop): not reachable from chat.
    `propose_template`'s schema (`intakeTemplateTools.ts:329-348`) sets `additionalProperties: false`
    on each `esignConfig.roles[]` entry with no `fields` property documented — the AI cannot construct
    this shape even though the backend parser (`parseTemplateEsignConfig`) now round-trips it.
  - Client mailing/business address + preferred contact (#495, captured at sign-up): never added to
    `MERGE_SLOT_FIELDS` (`templateMerge.ts:254`) — no `{{client_mailing_address}}` (etc.) merge token
    exists, system or client-sourced. The code comment at `templates/page.tsx:90-93` ("client_address
    is deliberately absent... triggers a questionnaire proposal") predates this and is now stale: the
    platform captures address once automatically at sign-up and no longer needs a per-service
    questionnaire re-ask for it.
  - #494 (matter-status mirror fix): internal consistency fix only, no chat/builder surface — not a gap.

## Critical files

`verticals/legal/src/api/assistantChat.ts` (attorney ClientTool assembly, `buildAttorneyClientTools`)
· `verticals/legal/src/api/clientAssistantChat.ts` (portal chat tools) ·
`verticals/legal/src/api/{composeEmailTool,esignLaunchTools,editorLaunchTools,capabilityTools,attentionFeedTool,getBriefTool,skillContext,workflowAuthoringTools,serviceAuthoringTools,intakeTemplateTools,costEnableTools,buildQuestionTools,kindAuthoringTools}.ts`
(the ClientTool builders) · `verticals/legal/src/adapters/claude.ts:358` (`ClientTool` type) ·
`verticals/legal/src/mcp/tools/*.ts` (the 337-op action/query surface) ·
`apps/legal-demo/components/UnifiedAssistantChat.tsx` (launch/card wiring; the stale
`PrepareSignature` import) · `apps/legal-demo/components/esign/EsignComposer.tsx` (the cutover
target `prepare_envelope` should point at) · `docs/design/esign-unify/DESIGN.md` (the ES-1..ES-6
plan this stale finding sits under).
