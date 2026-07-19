# SERVICE-BUILDER AUDIT — read-only diagnostic

Date: 2026-07-07. Repo state: `main` @ `1a15a10` ("fix(builder): polish round 2 — beta feedback on the rebuilt wizard (#297)").
Scope: static repo analysis only. No DB, no runtime, no changes. Runtime-only unknowns are in Section D.

---

## A. Verdict

The builder is a **hybrid: a model-driven tool-selection agent whose sequence is prescribed by prompt + a playbook document, not by code**. There is **no step enum, no switch statement, no wizard state machine anywhere in the code** — the conversation order (shell → templates → questionnaire → workflow → billing → enable) lives entirely in (a) the flag-gated system-prompt blocks in `verticals/legal/src/api/assistantChat.ts:603-627` and (b) the `firm-admin.build-service` skill markdown (`verticals/legal/skills/firm-admin/build-service.md`), force-loaded per turn when the message matches a regex. The model freely chooses which of ~19 tools to call each turn; the client UI auto-fires hidden continuation messages after each approval to keep it moving.

The single biggest reason the post-shell lifecycle fails: **the user's "0 fires" metrics are measuring pipes the builder never uses by design, and the pipe it does use dead-ends at a feature flag.** `workflow.define/start/advance` are *generic core primitives* (`packages/primitives/src/handlers/governance.ts:7,37,62`) that the legal vertical deliberately bypasses — workflows are written via `legal.service.set_lifecycle` and instances via direct `workflow_instance` SQL in `verticals/legal/src/lifecycle/instance.ts` ("They mirror the foundation primitives … rather than re-registering them", instance.ts:1-8). Meanwhile the runtime engine that would actually *run* an authored workflow to completion is gated behind `LEGAL_WORKFLOW_ENGINE`, default **OFF** (`verticals/legal/src/lifecycle/flags.ts:7-10`; no-op guards at `lifecycle/executor.ts:173` and `handlers/intake.ts:315`). If that flag is off in prod, every workflow the builder authors is inert configuration: no instance is ever created at matter open, nothing ever advances, nothing ever completes — exactly "botches lifecycle to completion." And the "non-branching" complaint is **by design, enforced twice**: the prompt mandates linear and `validateLinearLifecycle` rejects any branch (workflowAuthoring.ts:133).

---

## B. Findings

### 1. Locate the builder

**UI (one component — the builder is a mode of the unified chat, not a separate screen):**
- `apps/legal-demo/components/UnifiedAssistantChat.tsx` (2,444 lines) — chat FAB + build mode. `enterBuildMode()` at :840-874 (model upgrade to Opus + hidden priming message); question-batch buffering at :1469-1472; approve auto-continuation driver `handleApproved` at :1484-1513; model-facing history assembly at :1002-1032 and :1073-1096.
- `apps/legal-demo/components/WorkflowProposalCard.tsx` — renders a proposed workflow graph as an approval card.
- `apps/legal-demo/lib/assistantStream.ts` — SSE client; the full event vocabulary (service/questionnaire/template/cost/enable/kind/workflow proposals + `build_question`) at :44-142.

**Server:**
- `apps/legal-demo/app/api/attorney/assistant/stream/route.ts` — thin SSE adapter (maxDuration 300, keepalive every 10s).
- `verticals/legal/src/api/assistantChat.ts` (1,582 lines) — the brain: system prompt (:355-381), wizard prompt blocks (:603-627), tool registration `buildAttorneyClientTools` (:490-554), streaming loop (:1062-1346).
- `verticals/legal/src/adapters/claude.ts` — the Anthropic call + client-tool loop (`MAX_PAUSE_CONTINUATIONS = 4` at :477; loops at :529-560 and :600-671).

**Tools (each a `ClientTool` pair: read-only `get_*_context` + capture-only `propose_*`):**
- `verticals/legal/src/api/workflowAuthoringTools.ts` (get_workflow_context / propose_workflow)
- `verticals/legal/src/api/serviceAuthoringTools.ts` (get_service_context / propose_service / get_service_completeness)
- `verticals/legal/src/api/intakeTemplateTools.ts` (get_questionnaire_context / propose_questionnaire / get_template_context / propose_template)
- `verticals/legal/src/api/costEnableTools.ts` (propose_cost / propose_enable)
- `verticals/legal/src/api/buildQuestionTools.ts` (ask_build_question)
- `verticals/legal/src/api/capabilityTools.ts` (get_capability_context / request_capability)
- `verticals/legal/src/api/kindAuthoringTools.ts` (get_kind_context / propose_kind)
- `verticals/legal/src/api/skillContext.ts` (load_skill + catalog/forced-skill injection)

**Write paths (fire only on attorney Approve, via Next routes):**
- `apps/legal-demo/app/api/attorney/services/create-from-ai/route.ts` → `createServiceAI` → `legal.service.upsert` (serviceAuthoring.ts:325)
- `.../[serviceKey]/lifecycle/approve/route.ts` → `setServiceLifecycleAI` → `legal.service.set_lifecycle` (workflowAuthoring.ts:221-227)
- `.../[serviceKey]/questionnaire/approve-from-ai`, `.../templates/approve-from-ai`, `.../cost/approve-from-ai`, `.../lifecycle/enable-from-ai` — same pattern.

**State machine / step enum / phase list:** none exists in code. The only "steps" are prose in the system prompt and in `verticals/legal/skills/firm-admin/build-service.md:50-62` ("The build order").

**Prompts:** `SYSTEM_PROMPT` (assistantChat.ts:355-381), wizard blocks (assistantChat.ts:603-627), volatile block (assistantChat.ts:636-674), and the playbook skill `verticals/legal/skills/firm-admin/build-service.md` (114 lines) — stored as tenant data (skill library, migration `supabase/migrations_vertical/0083_skill_library.sql`) and force-loaded when `BUILD_REQUEST_RE` matches (assistantChat.ts:78-85).

### 2. Hardcoded vs model-driven — VERDICT: model-driven, prompt-prescribed

There is no code-driven sequence. Each turn registers all tools and the model picks. Proof that the *only* sequencing mechanisms are prompt text and a regex:

The forced-playbook trigger (assistantChat.ts:78-85):
```ts
const BUILD_REQUEST_RE =
  /\b(build|create|set\s*up|make|add|design)\b[\s\S]{0,40}\b(service|offering|workflow|practice\s*area|intake|questionnaire|template)\b/i
function wizardForcedSkillSlugs(message: string, selected?: string[]): string[] {
  const sel = selected ?? []
  if (!buildWizardEnabled() || !BUILD_REQUEST_RE.test(message)) return sel
  const slug = 'firm-admin.build-service'
  return sel.includes(slug) ? sel : [slug, ...sel]
}
```

Tool registration is flat — every wizard tool is available every turn once the flag is on; nothing in code says "you are on step 3" (assistantChat.ts:520-552, abbreviated):
```ts
if (buildWizardEnabled()) {
    tools.push(buildServiceContextTool(ctx))
    tools.push(buildProposeServiceTool(ctx, capture.serviceProposals))
    ... // questionnaire, template, completeness, cost, enable,
    ... // ask_build_question, capability, kind — all pushed unconditionally
}
```

The "wizard feel" is manufactured by two client-side mechanisms, not a state machine:
- A hidden priming message when the attorney clicks Build (UnifiedAssistantChat.tsx:870-873): `"I want to build a new service. Start the guided build interview now: ask me your first question with ask_build_question …"`
- A hidden auto-continuation after every approval (UnifiedAssistantChat.tsx:1505-1508): `` `✓ ${info.label} created — ${info.link}. Continue the guided build: do the next step now … If the whole service is complete, propose Enable.` ``

So: the model decides what to do next on every turn; the *intended* order is stated in prose (prompt + skill md); the client nudges it forward after approvals. Grep for a phase enum/switch across the builder files returns nothing.

### 3. Tool / action surface

Exactly as exposed to the model this turn (tool `name` strings), from `buildAttorneyClientTools` (assistantChat.ts:490-554):

Always registered (any Claude attorney turn):
| Tool | Kind | File |
|---|---|---|
| `log_feedback` | write (feedback event) | assistantChat.ts:386-432 |
| `load_skill` | read | skillContext.ts:19-54 |
| `produce_document` | capture-only | assistantChat.ts:438-478 |
| `get_workflow_context` | read | workflowAuthoringTools.ts:33-65 |
| `propose_workflow` | capture-only (validated) | workflowAuthoringTools.ts:139-210 |

Registered ONLY when `LEGAL_BUILD_WIZARD` is on:
| Tool | Kind | File |
|---|---|---|
| `get_service_context` / `propose_service` | read / capture | serviceAuthoringTools.ts:30-168 |
| `get_questionnaire_context` / `propose_questionnaire` | read / capture | intakeTemplateTools.ts |
| `get_template_context` / `propose_template` | read / capture | intakeTemplateTools.ts |
| `get_service_completeness` | read | serviceAuthoringTools.ts:178-211 |
| `propose_cost` / `propose_enable` | capture / capture | costEnableTools.ts:25,125 |
| `ask_build_question` | capture (pure UI) | buildQuestionTools.ts:48-139 |
| `get_capability_context` / `request_capability` | read / **write** (capability request row) | capabilityTools.ts:17-104 |
| `get_kind_context` / `propose_kind` | read / capture | kindAuthoringTools.ts:22,37 |

Specific confirmations:

- **legal.service.upsert — YES, indirectly.** The model can only `propose_service`; the write fires on attorney approve via `create-from-ai/route.ts` → `createServiceAI` → `submitAction({ actionKindName: 'legal.service.upsert' … })` (serviceAuthoring.ts:325).
- **workflow.define / workflow.start / workflow.advance — NO, and by design nothing in the legal vertical fires them.** The only registrations are the generic core handlers (governance.ts:7,37,62). The legal vertical explicitly bypasses them: authored graphs go through `legal.service.set_lifecycle` (handlers/serviceLibrary.ts:381), and instances are raw INSERT/UPDATE in `lifecycle/instance.ts:24-89` — "The ONLY code in the legal vertical that writes workflow_instance … They mirror the foundation primitives … rather than re-registering them" (instance.ts:1-8). **0 fires of workflow.\* in the live DB is expected and is not evidence of builder failure.** The correct instruments are `legal.service.set_lifecycle` actions, `workflow_definition` rows, and `workflow_instance` rows.
- **legal.workflow_step_template.create / update — NOT exposed to the builder.** The actions exist (workflowStepLibrary.ts:25,51) but the only caller is the MCP tool surface (`mcp/tools/workflowStepLibraryTools.ts:100`) used by the manual make.com-style builder UI. The chat model can only *read* the step library (`stepLibrary` inside get_workflow_context, workflowAuthoring.ts:91-96). **A builder-authored workflow never creates step-template rows — its stages are stored inline in `workflow_definition.states[]`** (see 0107 migration header: "Today a workflow step lives INSIDE a service (workflow_definition.states[])"). So "exactly 1 workflow_step_template row" measures the manual save-a-step feature, not the builder.
- **legal.matter.set_workflow — NOT exposed to the builder.** It exists as an MCP tool for the matter page (`mcp/tools/matterWorkflowTools.ts:26`) and API (`api/matterWorkflow.ts:19`); the chat never registers it.
- **Questionnaire/template creation — YES** (propose→approve): `propose_questionnaire`/`propose_template` → approve-from-ai routes.
- **Gates — YES, as data inside propose_workflow only.** `GATE_KINDS = ['automatic', 'attorney', 'client', 'system']` (lifecycle/types.ts:18) is an enum on the stage schema (workflowAuthoringTools.ts:119-122); the playbook mandates asking the gate per step (build-service.md:59). There is no separate gate tool.

### 4. System prompt dump (verbatim)

**4a. Base `SYSTEM_PROMPT` (assistantChat.ts:355-381) — joined with spaces at runtime; array entries reproduced verbatim:**

> You are the AI assistant inside Pacheco Law's practice app — a tool for a solo/small NC business-law firm.
>
> Help the attorney work: explain and use the app (intake, booking, drafting, review, Granola import, settings), summarize and answer questions about the matter or client in context, and draft internal text when asked.
>
> When matter or client context is provided below, ground your answers in it.
>
> When you point the attorney to a part of the app, LINK to it with a markdown link they can click. Main pages: Dashboard (/attorney), Matters (/attorney/matters), Clients (/attorney/crm), Contacts (/attorney/crm/contacts), Calendar (/attorney/calendar), Mail (/attorney/mail), Services (/attorney/services), Templates (/attorney/templates), Questionnaires (/attorney/questionnaires), Billing (/attorney/billing), Review queue (/attorney/review), Settings (/attorney/settings). Only link to these paths or links given in the context below; never invent entity ids.
>
> You are a drafting and workflow aid, not the attorney's legal judgment: when asked for a legal conclusion, give your best analysis but remind the attorney to verify it and that they own the legal opinion.
>
> ACCURACY OVER COMPLETENESS — never make anything up. Do not fabricate or guess at facts, statutes, code sections, regulations, case names, citations, court decisions, dates, deadlines, dollar figures, or quotations. If you do not know, or are not sure, SAY SO plainly — "I don't know", "I'm not certain", or "I couldn't find that" are always acceptable, correct answers and are far better than a confident guess. Never invent a statute number, case cite, or rule to fill a gap; if you can't verify a specific citation, give the general principle instead and say the citation needs to be confirmed.
>
> CITE YOUR SOURCES — ground every factual or legal claim in something the attorney can check: the matter/client context provided below, a skill you have loaded, a document the attorney shared, or a web-search result (include the link). When a statement rests only on your general training and is NOT grounded in those sources, label it as such and tell the attorney to verify it against the primary source (the actual statute, regulation, or case) before relying on it. Distinguish clearly between what the provided context says and what you are inferring or recalling.
>
> CITE THE GOVERNING LAW — when you state a legal rule or conclusion, name the controlling authority (the statute, regulation, or case) so the attorney can check it. Give a specific citation — a statute by name AND code section (e.g., "the Lanham Act, 15 U.S.C. § 1051 et seq."), or a case by name — ONLY when you are confident it is correct. If you are not certain of the exact section, subsection, pincite, or case name, name the statute or body of law generally (e.g., "the North Carolina Wage and Hour Act") and say the precise citation must be verified against the primary source. NEVER guess or invent a code section, subsection number, case name, date, or pincite to look authoritative — a wrong citation is worse than no citation. When web search is available, use it to confirm a citation before giving it.
>
> You also collect product feedback. When the attorney shares a complaint, idea, or praise: if it is vague or missing actionable detail (which screen, what they expected, the steps to reproduce), ask ONE short clarifying question first. Once you have a clear, specific item, CALL the log_feedback tool to file it with the right category, then tell the attorney it is logged and share the reference id the tool returns. Use the tool only for genuine product feedback, not for ordinary questions.
>
> PRODUCING DOCUMENTS — when the attorney asks you to draft, write, or produce a DOCUMENT (a letter, memo, engagement letter, agreement, NDA, contract, notice, resolution, etc.) — as opposed to answering a question or explaining something — generate the COMPLETE document and deliver it by CALLING the produce_document tool with a concise title and the full document in markdown. The attorney then sees it as a downloadable card (PDF/Word) they can save to the matter. Do this ONLY for genuine document deliverables, never for ordinary answers, analysis, or advice. Put the document text ONLY in the tool call — your chat reply must then be a SINGLE short sentence pointing them to it (e.g. "Here's the engagement letter — download it or save it to the matter below."), never the document itself. All the accuracy and citation rules above apply fully to documents you produce.
>
> BUILDING SERVICE WORKFLOWS — when the attorney asks you to build, add a step to, reorder, or change the WORKFLOW for one of their existing SERVICES (e.g. "build the workflow for NC SMLLC", "add a consultation step before review"), you compose a step-by-step workflow for them. ALWAYS call get_workflow_context FIRST to load the closed catalog of step actions you may use, the edge gates, the service's current workflow, and the firm's available document templates. Compose the workflow ONLY from those step-action kinds and gates — never invent a step kind or a gate. The workflow MUST be LINEAR: each step leads to exactly one next step (one entry step, one final step; no branching). You may attach documents to a step ONLY by referencing an existing firm template's templateEntityId from get_workflow_context — never invent a document or a template id. You only ever MODIFY existing services; you do not create new services. When you have a complete, valid workflow, deliver it by CALLING the propose_workflow tool — this does NOT save anything; it shows the attorney an approval card, and the workflow goes live only when THEY approve it. Put the workflow ONLY in the tool call; your chat reply must then be a SINGLE short sentence pointing them to the proposal to review, never the steps themselves.
>
> Keep replies focused and concise.

**4b. Appended when context exists (assistantChat.ts:589-598):** `--- Context ---\n${context.full}` (matter or client context from `assistantContext.ts`, depth-budgeted lean/balanced/generous), then when scoped: `This conversation is about the ${scope} at ${entityPath} — link to it with a markdown link when referring the attorney back to it.`

**4c. Appended ONLY when `LEGAL_BUILD_WIZARD` is on (assistantChat.ts:603-627), verbatim:**

> REUSE BEFORE YOU CREATE (this rule governs the whole build) — the firm already has services, questionnaires, document templates, and saved workflow steps. BEFORE you propose ANY new artifact you MUST call the matching get_*_context tool and SEARCH what already exists. If a matching SERVICE exists (check get_service_context's existingServices), propose EDITING that service — point the attorney to its key — and do NOT create a duplicate. If a matching QUESTIONNAIRE, document TEMPLATE, or workflow STEP exists, REUSE or ADAPT it — start from its content (its fields / its body / its action+gate) rather than authoring from scratch. Create a BRAND-NEW artifact ONLY when nothing close exists, and when you do, say WHY in the proposal's summary (e.g. "no existing template covered an NC operating agreement, so this is new"). Duplicating what the firm already has is a mistake; reusing or adapting it is the default.
>
> CREATING A NEW SERVICE — when the attorney asks you to create, set up, or add a new SERVICE offering (e.g. "create an NC SMLLC formation service", "add a trademark filing service"), you propose an empty service SHELL for them to approve. ALWAYS call get_service_context FIRST: SEARCH its `existingServices` for a close match (if one exists, propose editing it instead of a duplicate), and use the existing service keys (so a new key is unique) and the closed route + generation_mode vocabularies. Pick a route and generation_mode ONLY from those — never invent one. When you have a name and a valid choice, deliver it by CALLING the propose_service tool — this does NOT save anything; it shows the attorney an approval card, and the service is created (as a disabled draft) only when THEY approve it. Put the proposal ONLY in the tool call; your chat reply must then be a SINGLE short sentence pointing them to it to review.
>
> BUILDING A SERVICE'S INTAKE QUESTIONNAIRE AND DOCUMENTS — when the attorney asks you to build the intake form (questionnaire) or a document template for an EXISTING service, you propose them for approval, bound by the VARIABLE CONTRACT: every document {{token}} must map to a questionnaire field id, or it renders [[MISSING]]. For a QUESTIONNAIRE: call get_questionnaire_context FIRST (it gives the closed field types, the current form, and the {{tokens}} the service's documents reference) and build a form that collects a field for EACH template token (matching ids), then CALL propose_questionnaire. For a TEMPLATE: call get_template_context FIRST (it gives the questionnaire's field ids) and write a markdown body whose {{tokens}} are flat snake_case and bind to those field ids — never invent a dotted path — then CALL propose_template. Both tools only show an approval card; nothing is saved until the attorney approves. Put the proposal ONLY in the tool call; your reply is a SINGLE short sentence pointing them to it. DOCUMENTS COME BEFORE THE QUESTIONNAIRE (flow-aware) — when you propose a TEMPLATE for a service that has NO questionnaire yet, the template's tokens are NOT 'missing' or broken: they are exactly the fields the questionnaire will collect in the NEXT step (the questionnaire is reverse-engineered from the templates). Frame them that way to the attorney — forward-looking, not alarming. Only treat a token as a genuine [[MISSING]] gap once a questionnaire already EXISTS and a token has no matching question. REUSE EXISTING FIRM QUESTIONS — get_template_context returns `firmFieldLibrary`: the questionnaire field ids OTHER services already define (e.g. company_name, effective_date, principal_office_address). When a token you need already exists there, REUSE that exact field id and that question's definition when you build this service's questionnaire — do NOT re-invent a near-duplicate question, and do NOT call such a token missing. propose_template's result tells you which proposed tokens are reusable from the firm; carry those into propose_questionnaire by id.
>
> BUILDING A WHOLE SERVICE (the guided wizard) — when the attorney asks you to build, set up, or stand up a whole new service / offering / matter type end-to-end (e.g. "build me an NC LLC formation service"), the firm-admin.build-service skill is your AUTHORITATIVE PLAYBOOK: load_skill it and FOLLOW IT — the batched interview, the build order (shell → documents → questionnaire → workflow → billing → enable), when you may propose a new data kind vs. request a capability, and how to finish. Do not improvise the flow from memory. Two behaviors hold no matter what: (1) EVERY interview question goes through the ask_build_question tool (a click-to-answer card), NEVER free-text prose — and BATCH a related group into ONE turn (several ask_build_question calls in the same response: the ESSENTIALS — name + deliverables + route + generation mode + pricing — as one batch, then propose). Never drip one question per turn; never silently default the route or generation mode or a workflow gate — ASK. (2) DO NOT NARRATE your process — run reads/lookups silently, and keep your OWN prose to at most ONE short sentence per turn (the questions and proposals live in the cards, never duplicated in text). Before building from scratch, REUSE first: check the capability library (get_capability_context) and existing kinds (get_kind_context) so you wire in what the platform already does rather than reinventing it.

**4d. Then the skill catalog** (`buildSkillCatalogText`, skillContext.ts:60-78): `--- Skills ---` + routing preamble + `- slug — name: when-to-use` lines grouped by practice area (bodies load on demand via load_skill).

**4e. Volatile system block** (separate uncached block, assistantChat.ts:636-674): force-loaded skill BODIES (`--- Active skills (these were selected — follow them for this request) ---` — during a build this includes the FULL text of `firm-admin.build-service.md`, reproduced verbatim in the repo file and summarized in Finding 1/2; key excerpts: the build order at build-service.md:50-62, the "then-what" loop at :55-60, archetype rules at :24-32), then `The attorney is currently on ${currentPath}…`, then the live screen capture fenced by `«BEGIN SCREEN»/«END SCREEN»` capped at 16,000 chars (assistantChat.ts:564-566).

**Injected context inventory:** matter/client context (depth-budgeted), current route, live page text (≤16k chars), skill catalog (routing lines only), forced skill bodies, service/questionnaire/template/workflow/capability/kind context **only when the model calls the get_* tools** (returned as JSON tool results, e.g. workflowAuthoring.ts:97-105: closed catalog + gates + current graph + template library + step library). Tenant config and existing services are NOT in the prompt by default — the model must fetch them.

### 5. Conversation state

**Full text-only history is resent from the client every turn; there is no server-side draft object.** The server accepts `history?: Array<{ role, content }>` (assistantChat.ts:99) and splices it between system and the new user message (assistantChat.ts:1139-1143). The client builds it from rendered turns (UnifiedAssistantChat.tsx:1079-1096):

```ts
const MAX_HISTORY_CHARS = 100_000
const MIN_HISTORY_TURNS = 12
let start = fullHistory.length
let budget = MAX_HISTORY_CHARS
for (let i = fullHistory.length - 1; i >= 0; i--) {
  budget -= fullHistory[i]!.content.length
  if (budget < 0 && fullHistory.length - i > MIN_HISTORY_TURNS) break
  start = i
}
const history = fullHistory.slice(start)
```

Two lossy compressions matter for a build:
1. **Truncation:** oldest turns beyond 100k chars are dropped (min 12 turns kept). A long build loses its early decisions.
2. **Card flattening:** a card-heavy assistant turn is stored for the model as a stub, not its content (UnifiedAssistantChat.tsx:1016-1029): questions are replayed as `[You asked via ask_build_question (key "route"): …]` but **all proposals collapse to** `[You presented ${proposals} proposal card(s); the attorney approves in the UI and a confirmation message follows on approval.]` — the actual graph/questionnaire/template the model proposed is NOT replayed. On later turns the model literally cannot see what it built earlier; it only knows *that* it proposed something. Tool-round intermediates (`carryTurns` in claude.ts:588) live only within one turn and are discarded after it.

Within one turn, the client-tool loop is capped: `MAX_PAUSE_CONTINUATIONS = 4` (claude.ts:477). At `i >= 4` a `tool_use` stop is no longer honored — the loop `break`s (claude.ts:656-670), silently dropping the model's pending tool call mid-step.

Approvals and answers return as **hidden continuation user messages** (synthetic strings, UnifiedAssistantChat.tsx:1497,1506); batched question answers buffer client-side and fire as one combined hidden message (:1533-1539). If a turn is `busy`, the continuation is **silently skipped** (`if (busy) return`, :1495,1504) — the build stalls until the attorney nudges manually.

### 6. Workflow generation path

What SHOULD happen (flag-on): interview via `ask_build_question` ("then-what" loop, build-service.md:55-60) → `get_workflow_context` (closed catalog + gates + current graph + template ids + step library, workflowAuthoring.ts:77-106) → `propose_workflow` (validated: structural + closed vocab + `validateLinearLifecycle` + real template ids, workflowAuthoring.ts:127-149) → approval card → attorney approves → `POST /api/attorney/services/[serviceKey]/lifecycle/approve` → `setServiceLifecycleAI` → reasoning_trace + `legal.service.set_lifecycle` as the Claude agent actor (workflowAuthoring.ts:202-228) → handler seals prior version, inserts `workflow_definition` version+1 (handlers/serviceLibrary.ts:371-381).

- **Does any builder path create `workflow_step_template` rows?** **No.** Stages are stored inline in `workflow_definition.states[]`; the step library is read-only to the builder (Finding 3). 1 row in prod ⇒ one manually saved step, nothing more.
- **Does any builder path fire `workflow.define/start/advance`?** **No — nothing in the legal vertical does, by explicit design** (instance.ts:1-8). Those handlers exist only as generic core primitives.
- **Does an authored workflow ever RUN?** Only if `LEGAL_WORKFLOW_ENGINE` is on: `matter.open` stands up a `workflow_instance` inside a SAVEPOINT (handlers/intake.ts:315-333) and lifecycle events advance it via `dispatchLifecycleEvent`, which is "a PURE NO-OP unless the engine flag is on" (executor.ts:167-175: `if (!workflowEngineEnabled()) return`). Flag off ⇒ authored workflows are frozen config; no instance, no advancement, no completion — while `matter_status` (the pre-engine status field) remains the actual driver.
- So the gap is **not** a missing route from the builder to workflow authoring (it exists and validates hard); it is (a) the runtime engine being flag-gated off (verify in prod), and (b) everything after the shell also being gated on `LEGAL_BUILD_WIZARD` + the model actually following a prose playbook across a fragile multi-turn relay.

### 7. Hardcoded content inventory

| # | What | Where |
|---|---|---|
| 1 | Firm identity baked into the prompt: "Pacheco Law's practice app — a tool for a solo/small NC business-law firm"; playbook assumes "North Carolina + federal" unless doubted | assistantChat.ts:356; build-service.md:44 |
| 2 | Closed step-action catalog — exactly 8 kinds: `view_intake, view_consultation, generate_document, review_send_document, approve_send_invoice, await_payment, manual_task, complete_matter`, each with hardcoded label/description/defaultGate/blocking. Any attorney process outside these squeezes into `manual_task` | lifecycle/catalog.ts:18-80 |
| 3 | Closed gate set: `['automatic','attorney','client','system']` | lifecycle/types.ts:18 |
| 4 | **Linear-only enforced** — schema comment "LINEAR ONLY: a non-terminal stage has EXACTLY ONE edge", prompt "The workflow MUST be LINEAR … no branching", and `validateLinearLifecycle` rejection. The user's "non-branching" observation is a designed constraint, not a bug | workflowAuthoringTools.ts:112-115; assistantChat.ts:379; workflowAuthoring.ts:133 |
| 5 | Closed route/mode vocabularies: `SERVICE_ROUTES = ['auto','manual']`, `SERVICE_GENERATION_MODES = ['template_merge','ai_draft']` | serviceAuthoring.ts:42-44 |
| 6 | Build-intent regex `BUILD_REQUEST_RE` deciding whether the playbook is force-loaded — a message phrased outside the verb/noun pattern runs WITHOUT the orchestrator playbook | assistantChat.ts:78-79 |
| 7 | Fixed build order + essentials batch + "then-what" loop script — prose in the skill md, hardcoded as content | build-service.md:38-62 |
| 8 | Hidden priming message and both continuation message strings (incl. the wrap-up script "close with 'Let me know how else I can help!'") | UnifiedAssistantChat.tsx:871, 1497, 1506 |
| 9 | Client-facing description leak filter (regex rejecting "workflow", "intake", "auto-generат…" etc. in descriptions) | serviceAuthoringTools.ts:126-131 |
| 10 | Default confidence 0.7 when the model omits it; clamps 0.99 max / 0.6 fallback | workflowAuthoringTools.ts:197-200; workflowAuthoring.ts:234-238 |
| 11 | Loop/size limits: `MAX_PAUSE_CONTINUATIONS = 4`, `MAX_HISTORY_CHARS = 100_000`, `MIN_HISTORY_TURNS = 12`, page capture 16k, attachments 60k/160k | claude.ts:477; UnifiedAssistantChat.tsx:1087-1088; assistantChat.ts:564,679-680 |
| 12 | Build mode force-upgrades the model to `claude-opus-4-8` (hardcoded id), falling back to default/any work-rate Claude | UnifiedAssistantChat.tsx:860-864 |
| 13 | Entry-state fallback `'intake_submitted'` when a graph has no entry stage at instance creation | handlers/intake.ts:329 |
| 14 | Claude agent actor UUID hardcoded (`00000000-0000-0000-0001-000000000004`) | workflowAuthoring.ts:35; serviceAuthoring.ts (same pattern) |
| 15 | Card content NOT replayed to the model in history — proposals flattened to a count | UnifiedAssistantChat.tsx:1026-1029 |

---

## C. Top 5 root causes of "botches everything after the shell" (most causal first)

1. **The lifecycle never RUNS because the runtime engine is flag-gated off (`LEGAL_WORKFLOW_ENGINE`, default OFF), and the diagnosis measured the wrong pipes.** `workflow.define/start/advance = 0` is by-design (the legal vertical never calls them — instance.ts:1-8), and `workflow_step_template ≈ 1` measures the manual step-library, not the builder. But the real signal hiding underneath: with the engine flag off, `matter.open` creates no `workflow_instance` (intake.ts:315) and `dispatchLifecycleEvent` is a no-op (executor.ts:173) — so even a perfectly authored workflow never starts, advances, or completes. Verify the prod env var first; if it's off, "lifecycle to completion" is dead regardless of what the AI authors.
2. **Everything past the shell rides on prose compliance across a fragile multi-turn relay, not on any enforced sequence.** No code tracks build progress; the order lives in a skill document the model must keep obeying, and forward motion depends on hidden client continuations that are silently dropped when `busy` (UnifiedAssistantChat.tsx:1495,1504) and on `BUILD_REQUEST_RE` matching the attorney's phrasing to even load the playbook (assistantChat.ts:78-85). Any missed link (unapproved card, dropped continuation, regex miss, playbook drift over a long session) stops the build right after whatever was last approved — most often the shell.
3. **The model cannot remember what it built.** History replays proposals as `[You presented N proposal card(s)…]` with zero content (UnifiedAssistantChat.tsx:1026-1029) and truncates past 100k chars (:1087-1096). By the workflow/billing steps of a real build, the model has lost the actual template tokens, questionnaire fields, and graph it proposed — producing the "doesn't understand what it's building" feel and forcing re-reads (or errors) late in the build.
4. **The closed, 8-action linear-only workflow vocabulary flattens whatever the attorney describes.** Every step must be one of 8 catalog kinds (catalog.ts:18-80), every graph strictly linear (validateLinearLifecycle; prompt at assistantChat.ts:379), and anything else is either `manual_task` or a filed `request_capability`. The output is structurally guaranteed to feel hardcoded, generic, and non-branching — that is the validator speaking, not the model failing.
5. **The per-turn tool-round cap (`MAX_PAUSE_CONTINUATIONS = 4`) silently truncates heavy build turns.** A turn that does context reads + a question batch + a propose + a validation-retry exceeds 4 rounds; at the cap a `tool_use` stop is ignored and the loop breaks (claude.ts:551,656-670), discarding the pending tool call with no error — a step that just… doesn't happen.

## D. Open questions (need runtime / prod observation — not answerable from the repo)

1. **Prod values of `LEGAL_BUILD_WIZARD` and `LEGAL_WORKFLOW_ENGINE`** (Netlify env). Both default off. The reported "189 legal.service.upsert fires" cannot distinguish builder-created shells (agent actor `…0004`, via create-from-ai) from manual Services-editor upserts — check `action.payload`/actor on those rows. If shells really come from the builder, the wizard flag is on; the engine flag is the open one.
2. **Is `firm-admin.build-service` actually seeded in the prod tenant's skill library** (migration 0083 table; skills are tenant DATA, loaded by slug at runtime — skillContext.ts:47)? A missing/stale row silently degrades the whole build to the short prompt blocks.
3. **Live counts that would confirm/deny the engine story:** `workflow_definition` rows with non-empty `states` (did any builder workflow get approved?), `workflow_instance` rows (did any ever start?), `observation` events tagged `workflow_engine_skipped` (intake.ts:339-349).
4. **Which model actually runs builds in prod** — build mode wants `claude-opus-4-8` but falls back per connection (UnifiedAssistantChat.tsx:860-864); a weaker fallback would explain compliance drift on the long playbook.
5. **Where real sessions stall:** the `assistant.turn` event payloads record proposals per turn — reading a few live build threads would show whether builds die at unapproved cards, dropped continuations, or the 4-round cap. (Requires prod DB read; out of scope here.)
6. Whether attorneys reach the builder through the Build button (primed + flagged path) or by free-typing a request that misses `BUILD_REQUEST_RE` — analytics/runtime only.
