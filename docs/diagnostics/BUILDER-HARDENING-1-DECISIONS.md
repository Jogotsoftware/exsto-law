# BUILDER-HARDENING-1 — decision log

Session date: 2026-07-08 · Branch `builder-hardening-1` · PR [#298](https://github.com/Jogotsoftware/exsto-law/pull/298) · Map: [SERVICE-BUILDER-AUDIT.md](./SERVICE-BUILDER-AUDIT.md)

## The one thing Joe must do

**Netlify → exsto-law site → environment variables → set `LEGAL_WORKFLOW_ENGINE=1`** (the flag accepts `1` or `true`; anything else is OFF — `verticals/legal/src/lifecycle/flags.ts:7-10`). After the next deploy, the new boot log line proves the live state: look for `[flags] LEGAL_WORKFLOW_ENGINE=ON LEGAL_BUILD_WIZARD=ON` in the Netlify function logs (`apps/legal-demo/instrumentation.ts`). Also confirm `LEGAL_BUILD_WIZARD=1` is present (it almost certainly is — builder shells are being created in prod).

Second post-merge step: re-seed the rewritten playbook skill to prod tenants — `verticals/legal/demo/seed-firm-admin-skills.ts` (skills are tenant DATA; the repo `.md` is only the source; without the reseed prod keeps running the old interview).

## Decisions (non-obvious rationale only)

1. **WP4.2 brief is DERIVED, not stored.** The session brief prescribed persisting via "S2's chat-conversation namespace pattern" — **that pattern does not exist in this repo** (zero `namespace` hits under `verticals/legal`; consistent with prior worker-brief fiction). Re-deriving the brief each turn from what the substrate already persists (service row, questionnaire, templates+tokens, lifecycle, cost, completeness) covers the same need with zero migrations and cannot drift from reality.
2. **Brief reads via `listServicesIncludingInactive`, not `getService`.** Caught against the live DB: `getService` is deliberately active-only, and a service under construction is a *disabled draft* for the entire build — the active-only read reported "shell does not exist" mid-build.
3. **Cap-hit surfaces as a new `notice` SSE event, not `error`.** The client's `onError` marks the attempt failed and auto-regenerates the whole reply — an error event would have discarded a good streamed reply. `notice` renders a visible warning on the turn, replays into model history, and records an `observation` event (`tag=assistant_tool_cap`) through the action layer.
4. **Doctrine + interview live in ONE home** — the `firm-admin.build-service` skill (its header comment already names it the single source of truth). The inline wizard block in `assistantChat.ts` stays a pointer, but its two "hold no matter what" behaviors, plus `propose_service`'s field descriptions/refusal text and `ask_build_question`'s description, were realigned — otherwise those surfaces would keep instructing the model to ask "route?" cold, fighting the new playbook.
5. **"Flag off → observation logged" (acceptance B negative) reconciled, not built.** Flag-off is the dormancy contract's intentional, perfect no-op (`handlers/intake.ts` engine block). The `workflow_engine_skipped` observation exists for a different case: engine ON but instance creation *failed*. Changing dormancy to log would violate the day-one contract for zero diagnostic value.
6. **Continuation queue is one slot** (`pendingContinuationRef`): approvals are sequential by construction, and the latest continuation supersedes — a list would replay stale nudges.
7. **No migration.** Frontier re-verified live: `private.vertical_migration` max = **0117**. Nothing in this session needed a kind.
8. **Tenant-neutral wording held.** No new "Pacheco Law" text added anywhere; the pre-existing hardcoded firm identity at `assistantChat.ts` `SYSTEM_PROMPT` (audit finding 7.1) is untouched and remains flagged for the tenancy pass.

## Acceptance — receipts

**Local gate:** `typecheck` ✓ · `tsc -b` ✓ · `next build` (apps/legal-demo) ✓ · `lint` ✓ · `format:check` ✓ · `test:unit` **39/39 ✓** (new suites: `build-brief`, `build-history-content`, `build-mode-forcing` — added to the unit list).

**B (engine mechanics, live DB `jfcarzprfpoztxuqykoe`, flag on for the run):** `tests/vertical/workflow-engine.test.ts` **3/3 ✓** against the live DB. SQL receipt (workflow_instance joined to its definition):

| service_key | current_state | history_len |
|---|---|---|
| wf_engine_1783484469861_jds40w | intake_submitted | **1** (created at matter.open) |
| wf_engine_1783484472359_z0a37s | consultation_booked | **2** (one advance) |
| wf_engine_1783484476547_0zxbb2 | closed | **5** (full lifecycle to completion) |

Test services are disabled drafts (`active=0` — not client-visible); substrate is append-only, rows remain as receipts.

**WP4.2 (live brief render, prod tenant `…0001`):**
- `ga_mutual_nda` (active): shell + full token list + questionnaire field ids + `Billing (approved): fixed 500.00` + `Enable gate: READY`.
- `healthcare_employment_contract_review` (disabled draft): shell + `Templates: none yet.` + `Open items before Enable: needs a questionnaire (at least one section with one field); auto-route service needs at least one document to draft` — exactly the mid-build shape the model needs.

**Prod state snapshot (2026-07-08):** frontier 0117 · 0 currently-active workflow definitions with non-empty `states` · 3 pre-existing `nc_single_member_llc_formation` (v22) instances all `history_len=1` — i.e. instances have been created in prod but **never advanced** in real usage. That "advances never fire outside tests" question is the next runtime investigation (out of this session's scope; the flag + wiring verifiably work per receipts above).

## Not verifiable from this session (requires a human/browser run)

- **A (full in-app AI build)** and **C (transcript criteria)**: need an interactive build. Protocol for Joe (or a follow-up session with browser control): click **Build** in the chat → describe a service conversationally → verify (1) zero questions containing route/generation_mode/kind/gate/entity, (2) zero re-asked answers, (3) derived choices arrive as "Sounds like X — right?" confirmations, (4) post-workflow turns reference the templates/fields by name (WP4 receipt), then run the acceptance SQL: 1 service + questionnaire + ≥1 template + `jsonb_array_length(states) > 0` + cost + enabled.
- **D (>10-round cap)**: can't be forced deterministically (the model decides its round count). The cap path is 3 lines shared by both loops, unit-visible by construction; at runtime a hit produces the visible ⚠️ notice on the turn AND `SELECT * FROM event e JOIN event_kind_definition k ON k.id=e.event_kind_id WHERE k.kind_name='observation' AND e.payload->>'tag'='assistant_tool_cap'`.

## Files changed

`verticals/legal/src/adapters/claude.ts` · `verticals/legal/src/api/assistantChat.ts` · `verticals/legal/src/api/buildBrief.ts` (new) · `verticals/legal/src/api/serviceAuthoringTools.ts` · `verticals/legal/src/api/buildQuestionTools.ts` · `verticals/legal/src/api/index.ts` · `verticals/legal/skills/firm-admin/build-service.md` · `apps/legal-demo/components/UnifiedAssistantChat.tsx` · `apps/legal-demo/lib/assistantStream.ts` · `apps/legal-demo/lib/buildHistoryContent.ts` (new) · `apps/legal-demo/instrumentation.ts` (new) · `tests/vertical/build-{brief,history-content,mode-forcing}.test.ts` (new) · `package.json`

---

# MERGE-VERIFICATION (BUILDER-HARDENING-1-MERGE, 2026-07-08)

## 1. Merge
- PR #298 merged (squash) with CI green on the final commit (`verify` pass, `invariants` pass, deploy-preview ready).
- **Merge SHA: `a836f521a32eed01e0b98ecbabd74ecdb6a291d7`** — confirmed as the tip of `main`.

## 2. Deploy + flag verification
- **Netlify deploy `6a4dd45580a6510008bf3894`** — `state: ready`, `context: production`, `commit_ref: a836f521…` (the merge commit), published `2026-07-08T04:40:50Z`, 1 function deployed (Next.js Server Handler).
- **Boot log line: NOT retrievable with this session's tooling.** The Netlify MCP connectors expose project/deploy metadata only — no function/runtime log read. The receipt Joe can pull in one click: **Netlify → exsto-law → Logs → Functions → Next.js Server Handler**, look for the cold-start line
  `[flags] LEGAL_WORKFLOW_ENGINE=ON LEGAL_BUILD_WIZARD=ON`
  (emitted by `apps/legal-demo/instrumentation.ts` on every boot). The session brief states the env var is already set; nothing in this session contradicts that, but the log line itself remains Joe's eyeball check. If it reads `OFF`, set `LEGAL_WORKFLOW_ENGINE=1` and redeploy.
- Proceeding past this step was safe by construction: step 3 is a DB write (deploy-independent) and step 4 runs in a local process with the flag set explicitly.

## 3. Playbook reseed (content-checked)
- Ran `verticals/legal/demo/seed-firm-admin-skills.ts` against prod (tenant-zero, the only tenant with the firm-admin skill set — Liberty Legal has the base 104 skills, no firm-admin five; sandbox/platform have none). All 5 upserted; only `build-service.md` changed in #298.
- **Receipt (corrected query — the brief's `entity.metadata->>'body'` shape is not how skills are stored; they are `skill_*` attribute rows, per `queries/skills.ts`):** latest `skill_body` attribute for the entity whose `skill_slug='firm-admin.build-service'`:
  - `valid_from = 2026-07-08 04:46:31Z` (postdates the 04:40Z merge deploy)
  - `body_len = 16,437`
  - `body_head` (verbatim): `## What a service IS (the doctrine — every decision serves this)\n\nA service is a PRODUCTIZED OFFERING a CLIENT initiates from the firm's public site: intake → automated work (drafting / review / scheduling) → attorney gates ONLY where legal judgment is require…`
  - Content check ✓ — the rewritten doctrine/process-first playbook, not the old build-order opening.

## 4. Runtime smoke — sandbox only (`00000000-0000-0000-00fe-000000000001`)
Created `hardening_smoke_1783486049122` (disabled draft, not client-visible) via `legal.service.upsert` + `legal.service.set_lifecycle` (5-stage authored graph, v2). Drove a matter through REAL action paths with `LEGAL_WORKFLOW_ENGINE=1`; instance `9c1e74b0-7ee7-4850-81b9-43b8b2bad2e7`, all receipts `tenant_id = 00000000-0000-0000-00fe-000000000001`:

| Step (real action) | current_state | history_len |
|---|---|---|
| `intake.submit` + `matter.open` | intake_submitted | **1** |
| `legal.matter.advance` (gate client, trigger booking.create) | consultation_booked | **2** |
| `legal.matter.advance` (gate attorney) | in_review | **3** |
| `draft.merge` + **`draft.approve`** (auto-advance via `advanceInstanceOnApprove`) | approved | **4** |

Wiring note (diagnosis, no patch): **`booking.create` itself dispatches no advance** — the only lifecycle-event dispatchers in handlers are `transcript.received` (call), `invoice.paid` (invoice), `esign.completed` (esign). A client edge's `via: 'booking.create'` is audit metadata; the real driver for client/attorney gates is `legal.matter.advance` (the matter Workflow window), plus `draft.approve`'s built-in advance. By design per `handlers/workflow.ts`'s header, but it means a client booking does not auto-advance the instance — if auto-advance-on-booking is wanted, that's a small dispatch addition to the booking handler (future work, out of scope).

## Conclusion on the June "stuck" instances — the Session-1 hypothesis is REVISED
The three tenant-zero instances were **not** created by `matter.open` with the flag on, and their freeze is **not** evidence that real matters advance in tests but freeze in usage. Receipts: all three were created by **`system.bootstrap`** (a backfill) on `2026-06-24 02:30Z`, stamped at each matter's then-current status — which is why `history_len=1` even at `approved` (an instance created *in* `approved` has one history entry by construction). Since then two of the three matters' `matter_status` moved on (**desynced**: instance `intake_submitted` vs status `consultation_cancelled`; instance `approved` vs status `consultation_booked`) while the instances never moved — exactly what an OFF engine flag produces (legacy `matter_status` writes continue; instances are never driven). **The engine machinery itself is proven live end-to-end by the sandbox smoke above; with the flag on in prod, new matters will bind instances at `matter.open` and advance through the real endpoints.**

June instance ids + disposition (recommendation only, no action taken):
- `9703764d-74a3-4f9f-baac-2e41656493d3` — state `intake_submitted`, matter now `consultation_cancelled`
- `309356e1-5fc0-4947-ae11-78c49fbbc2a1` — state `approved`, matter now `consultation_booked`
- `961c452d-79e3-437e-a5b3-7da3336771db` — state `approved`, matter now `approved` (in sync)
**Recommendation: leave documented.** They are append-only backfill artifacts bound to superseded v22; do not advance them (stale test matters in a real firm's tenant). If tidiness is ever wanted, the correct instrument is a one-time `system.bootstrap`-style resync backfill (system actor, new history entries referencing what they correct) — not manual advances and not deletion.

## 5. WP5 spot-check (reconciled)
There is **no dedicated `%tool_cap%` event kind** — by design, the cap marker is the core-seeded **`observation`** kind with `payload->>'tag' = 'assistant_tool_cap'` (`assistantChat.ts` → `recordToolCapObservation`). Receipt: `observation` kind exists and is queryable in all three working tenants (tenant-zero id `…0014-000000000001`, Liberty, sandbox); **0 fires** to date (fine — existence/queryability was the check). The watch query going forward:
`SELECT * FROM event e JOIN event_kind_definition k ON k.id=e.event_kind_id WHERE k.kind_name='observation' AND e.payload->>'tag'='assistant_tool_cap';`

## Out of scope, unchanged
The interactive build-interview acceptance (Session 1 A/C) remains Joe's run — protocol above in "Not verifiable from this session". No registry changes, no new step kinds, no fixes applied beyond this report.

---

# CAPABILITY-RUNTIME-1 (2026-07-08) — executable capability registry + `invoke_capability`

Branch `capability-runtime-1` (off `main` @ `808eafc`, post-#300) · migration **0118** (frontier was 0117) · id block **1019** (event kind). Makes capabilities EXECUTABLE: a workflow can now RUN a client through a service end to end, not just author one.

## What shipped (ADR 0046)
- **WP1 — capability contract (additive jsonb, no migration).** `CapabilitySpec` gained `step_invocable, handler_key, inputs[] (key/provided_by/source/required), outputs[], default_gate, config_schema`. Upgrades ride the existing `legal.capability.upsert` (append-only supersession) — never a raw UPDATE.
- **WP2 — the `invoke_capability` step kind** (the 9th, and the ONLY open-ended one). `catalog.ts` + `types.ts` (`CapabilityStepConfig`). `validateLifecycle` already rejects unknown kinds; `validateProposedLifecycle` now also rejects an `invoke_capability` stage that names a non-live / non-invocable capability or an incomplete config. `get_workflow_context` returns `invocableCapabilities` alongside the 8 built-ins; the playbook gained a "Runnable capabilities / mid-service client asks" section (reseeded). `WorkflowProposalCard` shows the capability's human name, never the slug. Route `POST /api/attorney/matters/[id]/workflow/invoke` triggers it.
- **The runtime** (`api/capabilityRuntime.ts`): resolves the current stage's capability, dispatches its `handler_key`, records a `capability.invoked` audit event, applies the gate. **Execution is TRIGGERED, not auto-run in the advance transaction** — same model as `generate_document` (run by the matter Workflow window / the route / a caller), so no LLM call or job enqueue ever rides a lifecycle-advance transaction.
- **WP3 — two REAL handlers.** `ai_document_review.run` reuses `runDocumentReview` verbatim (Contract A → review memo via `draft.generate ai_review` → the existing review queue); the interview rubric is layered on as attorney **guidance** (so the bundled prompt keeps its `{{document_text}}` slot + reasoning-trace contract), and the invoke IS the enablement (bypasses the per-service review-enabled gate). `request_client_materials.run` reuses `attorney.message.post` (Contract B) and parks at the client gate. A contracted capability with no registered handler (e.g. `esignature`) raises a clear error + records an `observation` — never a silent no-op or simulated output.
- **Client-dispatch fix** (`handlers/clientDelivery.ts`, kept out of the pure `executor.ts`): a client's OWN action now advances a matter parked at a client gate — wired into `booking.create`, a CLIENT `document.upload`, and `client.message.post`. Flag-guarded; matches the client edge whose `via` equals the action kind.
- **Status coherence:** `draft.approve` hard-coded `matter_status='approved'`; for a multi-stage flow whose approve edge lands elsewhere (e.g. a mid-flow review → `materials_requested`), `advanceInstanceOnApprove` now re-mirrors the status to the real next stage (no-op for NC_SMLLC, whose edge.to is `approved`).

## Decisions (non-obvious rationale)
1. **No migration for the contract** — `capability_spec` is free jsonb, so the 6 contract fields are additive data through the existing upsert. The one migration (0118) seeds ONLY the `capability.invoked` audit event kind (failures reuse the core `observation` kind). Applied to all legal tenants at merge; the sandbox tenant was provisioned with it for the run (ledger left unstamped — the manager/merge applies 0118).
2. **Rubric as guidance, not base-prompt** — a first attempt passed the rubric as `promptOverride` (replacing the base prompt) and the model output lost the trailing ```json reasoning-trace fence the adapter parses. Fix: the base prompt always comes from the service/bundled default (which carries the slot + trace contract) and the rubric is appended as attorney guidance.
3. **Triggered execution, not auto-on-entry** — running the AI review synchronously inside a matter-advance transaction would put an LLM call (and a job enqueue) on the substrate write path (50 ms budget, transaction length). The engine already triggers step actions from the Workflow window; `invoke_capability` follows that. Auto-run-on-entry is a future enhancement.
4. **Completion is `invoice.paid`, not a manual system advance** — the seeded Claude agent actor `…0001-…0004` (audit finding 7.1, hardcoded) has no `actor` row in the sandbox tenant, so `legal.matter.advance` on a SYSTEM gate is (correctly) rejected for it. That is not a bug to route around: the `approved→closed` edge is meant to fire on `invoice.paid`. The run issues + pays a real invoice, which both creates the invoice row AND advances via `signalEvent` (no actor guard). Faithful, not forged.
5. **Authored via the action layer, run through the real runtime.** WP4's service was authored via the same actions the builder's approve routes call (`legal.service.upsert` + `createQuestionnaireAI` + `setServiceLifecycleAI`) — the builder's write path, deterministic. The interactive builder *conversation* (comprehension, solved in #298/#300) is the one piece still worth a human click-through; the get_workflow_context + playbook wiring makes it capable. This session proves the **runtime**, which was the gap.

## CLEANUP (through core, logged)
The live builder had filed two near-duplicate matter-close capabilities via `request_capability`. Both soft-retired to `status='deprecated'` via `legal.capability.upsert` (append-only supersession — no raw UPDATE, no delete); `step_close_notification` kept as the one canonical `requested` entry. Receipt: `attorney_notification_on_matter_close` → deprecated, `notify_attorney_when_a_matter_auto_closes` → deprecated, `step_close_notification` → requested.

## 21-capability classification (step_invocable + rationale)
**Invocable (3):**
| slug | gate | handler | rationale |
|---|---|---|---|
| `ai_document_review` | attorney | `…ai_document_review.run` **[REAL]** | runs an AI review of the client's uploaded doc → review memo in the queue |
| `request_client_materials` | client | `…request_client_materials.run` **[REAL, NEW]** | posts a portal request and parks until the client delivers |
| `esignature` | system | `…esignature.run` **[contracted, unbuilt]** | send-for-signature as a step; invoking it raises the not-executable error (the honest gap — the acceptance-F subject) |

**Not invocable (19):** `booking_scheduling` (intake front door + client gate, not a step) · `intake_document_upload` (a questionnaire field type) · `document_generation` (realized by the built-in `generate_document` step) · `attorney_review_queue` (a destination surface) · `workflow_engine` (it RUNS steps, isn't one) · `invoicing` (built-in `approve_send_invoice`/`await_payment`) · `stripe_payments` / `manual_payments` (payment rails/config) · `rates_billing` (build-time pricing config) · `client_portal` (always-on surface) · `client_messaging` (the surface `request_client_materials` is built on) · `mail` (comms surface) · `calendar_sync` (fires on booking) · `granola_import` (import integration) · `trust_accounting` (a ledger surface) · `template_editor` / `questionnaire_editor` / `ai_assistant` (authoring/chat surfaces) · `data_as_schema` (build-time authoring).

## Acceptance — receipts (sandbox `00000000-0000-0000-00fe-000000000001`; registry upgrades also applied to tenant-zero where the 21 live)
**A — registry.** Tenant-zero: 22 available (21 + `request_client_materials`) all contracted; **3 invocable** (matches the log); the two REQUIRED (`ai_document_review` attorney, `request_client_materials` client) contracted; 2 dupes `deprecated`; all writes via `legal.capability.upsert` (no raw UPDATE).

**B — build.** `employment_contract_review_mrc70en5` workflow_definition v3: **3 `invoke_capability` stages** — `[ai_document_review, request_client_materials, ai_document_review]` (one review w/ non-empty rubric, one client-materials w/ client gate). Questionnaire persists **`internal:true` fields** `review_summary`, `requested_changes` (closes WP5-in-data — first persisted internal fields).

**C — run.** Matter `9dc5244c-…`: two `document_draft` review memos (`550159f8…`, `f74436c2…`), both `generation_mode=ai_review`, `reasoning_trace_id` NOT NULL, `actor_type=agent` "Claude"; parks at attorney gate after each review; `draft.approve` advances; parks at the client gate until a client upload arrives; second review incorporates it; **invoice `INV-2026-0001` exists**; instance `current_state=closed, status=completed`. state_history (6 turns): `intake_submitted → first_review (via legal.matter.advance) → materials_requested (via draft.approve) → second_review (via document.upload, gate client) → approved (via draft.approve) → closed (gate system)`. Three `capability.invoked` events (first_review/attorney, materials_requested/client, second_review/attorney) — outputs persisted through core.

**D — client-dispatch.** state_history turn 4: `materials_requested → second_review`, `gate:"client"`, **`via:"document.upload"`** — advanced by the CLIENT's own upload, with NO `legal.matter.advance` in that turn.

**E — negative.** `validateProposedLifecycle` rejects an `invoke_capability` stage naming `client_portal` ("not step-invocable") and `does_not_exist_cap` ("unknown capability").

**F — negative.** Invoking `esignature` (contracted, unbuilt) on a probe matter threw `Capability "esignature" is contracted but has no executable handler … yet`, recorded an `observation` tagged `capability_not_executable`, produced no output, and the matter stayed on `sign_step` (no advance).

**G — negative.** While parked at the client gate (`materials_requested`, waiting on `document.upload`), an unrelated `client.message.post` did NOT advance — the matter stayed `materials_requested`.

**Local gate:** `build` ✓ · `typecheck` ✓ · `lint` ✓ · `format:check` ✓ · `test:unit` **48/48 ✓** (new `capability-runtime` suite) · invariants **16 pass / 77 DB-skipped** (storage-guard + authoring-vocabulary green).

## Files
Core: `verticals/legal/src/lifecycle/{types,catalog}.ts` · `verticals/legal/src/queries/capabilities.ts` · `verticals/legal/src/handlers/{capability,clientDelivery(new),booking,documentUpload,clientMessage,draft}.ts` · `verticals/legal/src/api/{capabilityRuntime(new),reviewDocument,workflowAuthoring}.ts` · `verticals/legal/src/api/index.ts` · `apps/legal-demo/components/WorkflowProposalCard.tsx` · `apps/legal-demo/app/api/attorney/matters/[id]/workflow/invoke/route.ts (new)` · `verticals/legal/skills/firm-admin/build-service.md` · `supabase/migrations_vertical/0118_capability_invoked_event.sql (new)` · `verticals/legal/demo/{seed-capabilities,cleanup-capability-dupes(new),caprt1-sandbox-run(new)}.ts` · `tests/vertical/capability-runtime.test.ts (new)` · `package.json`.

## Post-merge / remaining
- **Reseed the playbook** (`demo/seed-firm-admin-skills.ts`) so prod runs the new build-service.md (the invoke_capability section is a DB row until reseeded).
- **The matter Workflow window** has no "Run capability" button yet — the runtime + route exist and are proven; the UI affordance is the one production wiring left (an attorney currently can't trigger `invoke_capability` from the app, only via the route/API). Auto-run-on-entry is the follow-on.
- **Hardcoded Claude agent actor** (`…0001-…0004`) still assumed to exist in every tenant (audit 7.1) — flagged for the tenancy pass; the runtime inherits it.

---

# BUILDER-HARDENING-1.1 — interview polish + render-layer leak fixes (2026-07-08)

Follow-up after Joe ran a full interactive build (Healthcare Employment Contract Review) end-to-end: comprehension is solved; the remaining defects were the render layer leaking internal channels into the transcript, a few functional bugs, and interview pacing. Branch `builder-hardening-1.1`. No workflow-engine / step-catalog / gate / linear-constraint changes.

## The one root cause behind WP1–3 (verified on real turns)

The audit-style question in the brief for WP2 ("did the leaked turns call ask_build_question?") — the persisted `assistant.turn` event does NOT record `build_questions` (they're ephemeral), so I verified via the **`reply` text**: on the leaked turns (e.g. `1caf4303`, `ff9e0895`) the literal string `[You asked via ask_build_question (key "then_what_2"): …]` sits **inside the model's `reply` prose**, and every turn shows `bq_count = 0`. So the model did **not** call the tool — it **typed the annotation as prose**, imitating the `[You asked …]` / `[I'll continue …]` stubs it saw in its own history (`buildHistoryContent` appended them to the assistant's own message). WP2 and WP3 are the same disease at the model-INPUT layer. Fixed as a class at three layers:
1. **Model input** — `apps/legal-demo/lib/buildHistoryContent.ts`: history notes reframed to TERSE, third-person, `⟦…⟧`-sentinel-wrapped records with NO verbatim question text / field dumps (the live BUILD BRIEF already carries the substance). Nothing imitable.
2. **Render** — new `apps/legal-demo/lib/assistantText.ts` `stripMachinery()` removes `⟦…⟧` spans (incl. a half-streamed trailing open) and legacy bracketed machinery lines from ALL rendered assistant text (committed `t.content`, streaming, copy button). The last-line guarantee.
3. **Prompt** — one rule in `SYSTEM_PROMPT` (applies to every mode): never write `⟦`/`⟧`, never reproduce their content, never type a `[You asked …]`-style status line.

## Work packages
- **WP1** thinking → animated indicator only (`uac-thinking-body` prose removed); already excluded from history + persistence.
- **WP3** priming / approve-continuation / wrap-up strings wrapped by `driver()` in the `⟦…⟧` sentinel — acted on, never echoed; the wrap-up now passes the real booking URL.
- **WP4** booking link = `/book?service=<key>`: the enable route returns `bookingLink`, the enable card renders real "Open booking page →" + "Copy booking link" buttons, and the wrap-up continuation hands the model that exact URL. No more model-typed href routing to `/`.
- **WP5** diagnosis: the questionnaire schema had **no client/internal boundary at all** (the built `attorney_review` section's fields were plain `required:false`, nothing marked them). Fix = a new `internal` field flag (both branches): hidden from the `/book` client form + never client-required (view), and the builder marks attorney/system-filled tokens `internal:true` (field-flag). The token stays covered — variable contract intact.
- **WP6** playbook (`firm-admin.build-service.md`): ONE open opener → derive → ONE batched confirmation turn → propose within ~3 answers; every non-open question offers 2–5 inferred options + free-text Other + multi-select where applicable; then-what loop demoted to a fallback. `ask_build_question` already supported `choices`/`multi_select`/`allow_free_text` — **no schema change needed** (confirmed).
- **WP7** cards show human labels + plain-language gates ("waits for you" / "waits for the client" / "automatic"), field labels instead of ids, and no `[[MISSING]]` notation in the attorney view.
- **WP8** forced skill body moved from the uncached volatile block into the CACHED system prefix (`buildClaudeSystem`); per-turn token usage already persisted on `assistant.turn` (confirmed).
- **WP9** `question_without_card` observation: a server-side detector records when a `reply` parroted internal machinery (measurable WP2 recurrence).
- **WP10** verified the builder SIMULATED the "notify on close" gap (prose claim, **zero** capability rows). Added a no-simulate playbook rule (a claim to log ⇒ a `request_capability` call) and a `step_close_notification` `requested` capability to the seed backlog.

## Acceptance — receipts (all EXECUTION in sandbox `…00fe…0001`; project `jfcarzprfpoztxuqykoe`)

**Gate:** typecheck ✓ · tsc -b ✓ · next build ✓ · lint ✓ · format ✓ · test:unit **42/42** ✓ (new: `stripMachinery` + reframed `assistantHistoryContent` suites).

**Reseed (content-checked, tenant-zero, the wizard's tenant):** `firm-admin.build-service` `skill_body` `valid_from = 2026-07-08 06:00:51Z`; contains `BATCH, DON'T DRIP` (WP6) ✓, `CLIENT vs INTERNAL fields` (WP5) ✓, `NO-SIMULATE RULE` (WP10) ✓. Capabilities reseeded (22).

**A — scripted build through the REAL model (Opus), sandbox, new playbook seeded there.** Two runs:
- Healthcare review: T1 = ONE open opener card; T2 = **3 batched confirmation cards, each 2 options + Other**, all plain-language ("The client uploads their contract, and the main thing they get back is your plain-language email …— right?"); T3 = `service_proposal`. Reached the proposal in 3 answers.
- LLC formation (thin opener): the deliverables question surfaced as `Q(4opt/**MULTI**/other): What does the client walk away with at the end?` — multi-select present.
- **Machinery leaks in the rendered transcript across all runs: 0.** Zero thinking prose, zero `[You asked via ask_build_question …]`, zero injected-instruction text, zero platform vocabulary ("route"/"generation_mode" never spoken). Every question rendered as a card.

**B — WP4 booking link:** resolves to **`/book?service=<serviceKey>`** (the `?service=` preset the public page honors), returned by the enable route as `bookingLink` and rendered as a real button — not a model-typed link.

**C — WP5 internal boundary (sandbox service `wp5_review_1783490945326`):** stored schema keeps all 5 fields; the 3 attorney fields carry `internal:true` (`overall_summary`, `key_findings`, `attorney_name`). Applying the `/book` filter yields **only** `about_you → [client_name, contract_upload]`; the entire `attorney_review` section is hidden from the client. Variable contract still covered (all tokens present in the schema). Branch: **both** — added the field-flag AND the view respects it.

**D — WP8 token/cache (sandbox `assistant.turn` usage, the 3-turn run):**
| turn | input | output | cache_create | cache_read |
|---|---|---|---|---|
| T1 | 6 | 255 | **43,358** | 21,609 |
| T2 | 10 | 748 | 1,992 | **109,391** |
| T3 | 6 | 410 | 1,380 | **64,851** |
T1 creates the cache (the ~16k-char skill body + base prompt); T2/T3 read it back — cache-read ≫ 0 after the first turn, and tiny `input_tokens` prove the skill body now rides the CACHED prefix (WP8.1).

**E — WP9 telemetry:** `observation` kind queryable = true; `question_without_card` fires = **0** (target — all runs were leak-free). Watch query: `… WHERE k.kind_name='observation' AND e.payload->>'tag'='question_without_card'`.

**F — WP10 capability write:** `step_close_notification` now exists in tenant-zero with status `requested` (was: nothing, despite the builder's prose claim). Plus the no-simulate playbook rule so a future declared gap must call `request_capability`, and the WP9 detector to catch prose-only claims.

## Notes / not done here
- The interactive click-through build (a human approving each card in the browser) remains Joe's path; the scripted runs drive the same server generator with the same playbook and prove the transcript/interview/token behavior, but do not click Approve through the browser.
- The pre-existing hardcoded "Pacheco Law" firm identity in `SYSTEM_PROMPT` is still untouched — flagged (again) for the tenancy pass; no new tenant-specific text was added.
- Existing built services (e.g. tenant-zero's `healthcare_employment_contract_review`) predate the `internal` flag; their attorney sections gain it only on a re-propose of the questionnaire. New builds set it from the start.

---

# CAPABILITY-RUNTIME-1-MERGE (2026-07-08) — merge, activate, verify live

## Reconciliation (the brief's premise was stale)
The session brief stated "#301 is merged, CI green." It was **OPEN, MERGEABLE, CLEAN, all checks green** — never actually merged (`origin/main` was still `808eafc`/#300). Per the no-merge-manager operating model, merged it here: squash `ccbc00016fc07f2016b58aa4f89b5fa88ffb98b7` (#301) is the tip of `main`. Applied migration **0118** to prod via the action-independent path (idempotent `event_kind_definition` inserts — `capability.invoked` now exists in tenant-zero + Liberty + sandbox, exactly 1 each) and **stamped the ledger** (`private.vertical_migration` frontier is now **0118**, `applied_at 2026-07-08 15:21:59Z`).

## 1. Deploy confirm
Netlify production deploy **`6a4e6ae4f29dc10007f8dfa2`**, `commit_ref ccbc00016fc07f2016b58aa4f89b5fa88ffb98b7` (the #301 merge), `state: ready`, `context: production`, `branch: main`, published **2026-07-08T15:23:14Z**, `plugin_state: success`, 1 function (Next.js Server Handler). The **boot line** (`[flags] LEGAL_WORKFLOW_ENGINE=ON`) is NOT retrievable via the Netlify MCP (project/deploy metadata only — same limitation as #298); the env var persists across deploys from when Joe set it for #298, and the engine is functionally proven live by step 4 (a matter would not bind/advance an instance with the flag off).

## 2. Playbook reseed (content-checked)
Ran `seed-firm-admin-skills.ts` against prod AFTER the deploy went live. Receipt (attribute-row query on the `firm-admin.build-service` `skill_body`, NOT `metadata->>'body'`): `valid_from = 2026-07-08 15:24:52Z` (postdates the 15:23:14Z deploy), body `20,305` chars (was ~16,437 in #300 — grew by the new section). The invoke-capability section is present at char 11,191 — verbatim excerpt: *"Runnable capabilities (beyond the 8 built-in steps).** `get_workflow_context` also returns `invocableCapabilities` — real platform abilities a step can RUN, not just the built-in step actions. When a step the attorney described matches one, PREFER it…"* — plus the `request-client-materials` mid-service-client-ask guidance (`has_materials_language = true`). (The brief's probe phrase "prefer an invocable capability" is not verbatim; the actual wording is "PREFER it over a generic manual step" — same intent, confirmed by the heading + excerpt.)

## 3. THE OPEN QUESTION — is the client money-printer path autonomous today? **NO.**
**Capabilities do NOT auto-run on stage entry.** Traced from code: the ONLY caller of `invokeCapabilityForMatter` in the entire repo is `apps/legal-demo/app/api/attorney/matters/[id]/workflow/invoke/route.ts`. **No advance path references the capability runtime** — grep of `handlers/intake.ts` (matter.open), `lifecycle/executor.ts` (advanceMatter/signalEvent), `handlers/workflow.ts` (legal.matter.advance), `handlers/draft.ts` (advanceInstanceOnApprove), `handlers/clientDelivery.ts` (dispatchClientDelivery) returns **nothing**. In the verified end-to-end run, each `invoke_capability` stage was triggered by the **test harness calling `invokeCapabilityForMatter` directly** (standing in for the window/route). So when a matter enters an `invoke_capability` stage (e.g. `ai_document_review`), it **PARKS there inert** — the AI review fires only when someone POSTs to the invoke route, and **no UI calls that route** (the route shipped in #301; the "Run capability" button did not).

**Conclusion (which world):** the client self-serve path is **NOT autonomous**. Even if the graph advanced a client into the review stage on their own actions, the review would sit inert until a manual trigger. **The missing "Run capability" trigger (a Workflow-window button OR auto-run-on-entry) is a Phase-1 BLOCKER for the self-serve demo, not polish.** That is the priority-setting answer. (Not built this session, per scope.)

## 4. Money shot re-verified on the merged/deployed build (sandbox)
Tree parity confirmed: `git diff --stat cb3df1d ccbc000` is empty (the worktree tree == the squash-merged tree). Fresh run, real model, both sides — matter **`c5717ae0-8b57-4735-896d-563f00b7ecce`** (service `employment_contract_review_mrc8cjhs`), every row `tenant_id = …00fe-…0001`:
- `current_state=closed, status=completed`, **6 turns**: `intake_submitted → first_review (via legal.matter.advance, attorney) → materials_requested (via draft.approve, attorney) → second_review (**via document.upload, gate client**) → approved (via draft.approve, attorney) → closed (gate system)`.
- Both review memos: `generation_mode=ai_review`, **`reasoning_trace_id` NOT NULL** (all_have_trace=true).
- 3 `capability.invoked` events; invoice row exists (entity kind `invoice`, `INV-2026-0002`, newest sandbox invoice at 15:28:17Z).
The **client-gated advance via `document.upload`** (turn 4) is the client-dispatch fix firing on the deployed code.

## 5. Internal-flag confirm (WP5-in-data, live)
The brief's exact query (`entity` kind `questionnaire_template`, `metadata ILIKE '%"internal":true%'`) returns **0** — because in this codebase a service's questionnaire is stored as **`workflow_definition.transitions.intake_schema`**, not as a `questionnaire_template` entity's metadata. Querying the real location (service `employment_contract_review_mrc70en5`) shows the split:
- **Client fields** (`internal:false`): `concern` ("What are you worried about?"), `contract_file` ("Upload the contract to review") — section "About you and the contract".
- **Internal fields** (`internal:true`): `review_summary` ("Review summary"), `requested_changes` ("Requested changes") — section "Attorney review — completed during review".
The `/book` client view (`filter(f => !f.internal)`) hides the entire attorney section. WP5-in-data is proven live.

## Note — ADR 0046
There is **no `docs/adr/0046` file**; "ADR 0046" is used as a label in the code comments + this decision log, not a written ADR. Flag for a follow-up: write the ADR (or drop the label). Not blocking.

## Definition of done — met
#301 merged (`ccbc000`) + deployed (`6a4e6ae4…`, production ready) + confirmed; migration 0118 applied + ledger stamped; playbook reseeded + content-verified (invoke-capability section present, postdates deploy); step-3 answered definitively (**NOT autonomous — button is a Phase-1 blocker**, mechanism cited from code); fresh sandbox end-to-end receipted on the merged build; internal-flag split pasted. No wiring bug found; nothing worked around.

---

# CAPABILITY-AUTORUN-1 (2026-07-08) — auto-run invoke_capability stages on entry

Branch `capability-autorun-1` (off `main` @ `cd36dc2`). Closes the CAPABILITY-RUNTIME-1-MERGE step-3 gap: capabilities never fired on their own. Now an `invoke_capability` stage runs automatically when a matter ENTERS it, from any advance path — making the client self-serve path autonomous. No new step kinds, no gate changes, no migration.

## B — the mechanism (and how it preserves "no LLM in an advance transaction")
The hard invariant from #301: no LLM call ever rides an advance transaction. Preserved via a generic **post-commit queue**:
- `packages/substrate/src/context.ts` — `ActionContext` gains optional `afterCommit?: Array<() => Promise<void>>`.
- `packages/substrate/src/action.ts` — `submitAction` creates a fresh queue per call, passes a `handlerCtx` carrying it to the handler, and — **after `withActionContext` (the BEGIN/COMMIT wrapper) resolves, i.e. after the advance transaction has COMMITTED** — drains the queue, each callback in its own `withActionContext`/transaction. Callback errors are caught + logged so a failed side-effect never undoes the committed action.
- `verticals/legal/src/lifecycle/autoRun.ts` (new) — `scheduleCapabilityAutoRun(ctx, matter, newStageKey, graph)`: if the landed stage's action is `invoke_capability`, it pushes a callback that **dynamic-imports** `invokeCapabilityForMatter` (post-commit — no static lifecycle→api cycle) and runs it in its own context.

So the capability fires synchronously *within the request* but *outside* the advance transaction — exactly the required pattern. A handler never blocks the advance txn on the model; it schedules, the txn commits, then the model runs.

## WP1 — the 5 advance paths hooked
`scheduleCapabilityAutoRun` is called right after each path lands the matter on a new stage: `handlers/workflow.ts` (legal.matter.advance), `handlers/draft.ts` (`advanceInstanceOnApprove` — the draft.approve edge), `handlers/clientDelivery.ts` (`dispatchClientDelivery` — the client's booking/upload/reply), `handlers/intake.ts` (matter.open entry), `lifecycle/executor.ts` (`signalEvent` system events + each `advanceMatter` automatic hop). The advance-fn ctx (`{tenantId, actorId}`) is assignable to the helper's structural ctx, and at runtime carries the submitAction post-commit queue — so no type churn was needed.

## WP2 — idempotency (one guard, both paths)
`invokeCapabilityForMatter` now guards up front: if a `capability.invoked` event already exists for `(matter, stage)`, it returns `{ran:false, …skipped (idempotent)}` without re-running. Because `capability.invoked` is recorded ONLY on success, a prior success blocks a re-fire (auto-run + a stray manual call can't double-memo) while a prior FAILURE (observation only) leaves the stage re-invocable via the manual route. No new schema — a guard query on the existing event, no migration.

## WP3 — failure honesty (unchanged from #301)
The auto-run callback catches the capability's error: `invokeCapabilityForMatter` has already recorded the failure observation and left the matter parked; the caught error just stops a failed auto-run from failing the (committed) advance. No simulated success. The manual `POST …/workflow/invoke` route is untouched — it stays the retry/override path.

## Acceptance — receipts (sandbox `00000000-0000-0000-00fe-000000000001`, ZERO manual invoke in the flow)
Driver: a scratchpad harness `caprt1-autorun.ts` (NOT committed — it reads `SUPABASE_SERVICE_ROLE_KEY` to seed Storage test fixtures, which the `vertical-storage-guard` invariant quarantines to `adapters/storage.ts`, so the harness stays out of the guarded `verticals/` tree). The autonomy flow submits only advance actions (`legal.matter.advance`, `draft.approve`, client `document.upload`) and **never calls `invokeCapabilityForMatter`**; real contract bytes are uploaded to Storage so the auto-run's REAL `downloadObject` runs (no injected fake).

**A — autonomy.** Matter `2e6a6d28-…`, all rows `tenant_id=…00fe-…0001`, `closed/completed`, **6 turns**: `intake_submitted → first_review (via legal.matter.advance) → materials_requested (via draft.approve) → second_review (**via document.upload, gate client**) → approved (via draft.approve) → closed (gate system)`. Memo count = **1 right after the intake→first_review advance** and **2 right after the client's document.upload advance** — the AI reviews fired automatically on stage entry with no manual trigger between. 3 `capability.invoked` events (`first_review`/ai_document_review, `materials_requested`/request_client_materials, `second_review`/ai_document_review); both memos `reasoning_trace_id` NOT NULL, actor = Claude agent; invoice `INV-2026-0003`. **This is the self-serve autonomy proof.**

**C — idempotency.** Immediately after `second_review` auto-ran, a manual `invokeCapabilityForMatter` returned `ran:false` ("Capability for stage 'second_review' already ran … skipped (idempotent)"); memo count stayed **2** (no double memo).

**D — failure.** Esign-probe matter `225b352b-…`: advancing into the `invoke_capability(esignature)` stage auto-ran esignature, which failed (contracted, unbuilt). Receipt: `esign_state = sign` (NO advance), `capability_not_executable` observations = **2** (the auto-run + a manual re-invoke), `capability.invoked` rows = **0**. The matter is still re-invocable via the manual route (it threw the same clear error rather than being blocked by idempotency).

**E — gate integrity.** The client-gated `request_client_materials` auto-ran (sent the portal ask) then PARKED at the client gate (`parkedAtClientGate = true` — did not auto-advance past it); the attorney-gated reviews parked at the review queue. Gates unchanged.

**Local gate:** `build` ✓ · `typecheck` ✓ · `lint` ✓ · `format:check` ✓ · `test:unit` **51/51 ✓** (3 new `scheduleCapabilityAutoRun` scheduling tests) · invariants 16 pass / 77 DB-skipped.

## Prod note (synchronous-in-request)
Auto-run runs the capability inside the request that triggered the advance (per the required pattern — not fire-and-forget). The routes that can now trigger a slow AI review — the client `document.upload` route and the attorney `draft.approve` / `legal.matter.advance` routes — should carry `maxDuration ≥ the model budget` (the manual invoke route already has `maxDuration 300`). Small route-config follow-up for the deployed HTTP paths; the sandbox proof drives the action layer directly so it is unaffected. Later option: move `ai_document_review` auto-run onto the existing durable review-job worker (the pattern `requestDocumentReview` already uses) so the client upload request never blocks on the model.

## Files
`packages/substrate/src/{context,action}.ts` · `verticals/legal/src/lifecycle/{autoRun(new),index,executor}.ts` · `verticals/legal/src/handlers/{workflow,draft,clientDelivery,intake}.ts` · `verticals/legal/src/api/capabilityRuntime.ts` · `tests/vertical/capability-runtime.test.ts`. (Acceptance harness `caprt1-autorun.ts` lives in the scratchpad, not the repo — see the storage-guard note above.)

---

# WORKFLOW-AUTHORING-1 (2026-07-08) — the builder AUTHORS invoke_capability by conversation

Branch `workflow-authoring-1` (off `main` @ `fda1d8f`, post-#305). The runtime (CAPABILITY-RUNTIME-1/AUTORUN-1) executes hand-authored invoke_capability workflows end to end; the AUTHORING path was broken — the builder couldn't compose a valid `invoke_capability` step by conversation because it was never GIVEN the step shape, so it reverse-engineered the validator by rejection and never converged. Fix = make each capability SELF-DESCRIBE its authoring contract as data, and GENERATE the build-context the AI reads from that one contract (the same one the validator + runtime read). No migration, no runtime-path change.

## DIAGNOSTIC (the divergence, pasted)
1. **Canonical step shape** (the ONE definition the validator enforces — `api/workflowAuthoring.ts:validateProposedLifecycle` + `lifecycle/types.ts:CapabilityStepConfig`):
   ```json
   { "action": { "kind": "invoke_capability",
       "config": { "capability_slug": "ai_document_review",
                   "capability_config": { "rubric": "…" } } } }
   ```
   `capability_slug` is a DIRECT child of `action.config`; the schema's fields nest under `capability_config`.
2. **Real contract jsonb path:** NOT `entity.metadata.spec.*` (null). It is `attribute` rows on `platform_capability` entities: `capability_slug` / `capability_status` / `capability_spec` (the jsonb) — read by `queries/capabilities.ts:listCapabilities`. `capability_spec` already carried the full ADR-0046 contract (`step_invocable`, `handler_key`, `inputs[]`, `outputs[]`, `default_gate`, `config_schema`) for the real capabilities — **no stored-data gap**; the fix builds on it as-is.
3. **What `get_workflow_context` gave the builder (before):** `InvocableCapabilitySummary` = `{slug, name, purpose, defaultGate, inputsByProvidedBy, configSchema}` — names/purposes + the raw schema, but NEVER the wrapper shape. The tool's `action.config` JSON-schema was `{type:'object', additionalProperties:true}` — unconstrained.
4. **The divergence:** the summary's own field is named `slug`, so the model echoed `slug` (not `capability_slug`); `configSchema` was handed over unwrapped, so the model put `rubric` flat on `action.config` or copied the key `configSchema` itself. Errors were one-per-round and didn't name the expected path, so each fix broke another guess. **Root cause: the knowledge wasn't given → guessing-by-rejection.**

## THE FIX (self-describing contract; ONE source, three readers)
- **WP1/WP2 — generated step template.** New PURE module `lifecycle/capabilityAuthoring.ts`: `buildInvokeCapabilityStepTemplate(cap)` emits the literal `stage.action` for a capability from its `config_schema`, typed through `CapabilityStepConfig` so a field rename fails the TS build (no drift). `get_workflow_context` now returns, per invocable capability, a `stepTemplate` — the exact step to COPY (placeholders `<…>` for the values). Same module backs the validator's diagnostics, so the example shown and the error on a miss read the same schema.
- **WP3 — machine-readable errors + honest failure.** `diagnoseCapabilityStepConfig` / `diagnoseMissingCapabilitySlug` name the offending key AND the expected path (e.g. *"Found 'rubric' directly on action.config — it must be nested INSIDE action.config.capability_config"*), so ONE correction lands it. `propose_workflow` records each failed attempt; after **2** it hard-refuses to re-validate and tells the model to STOP and report the failure. A turn that tried and never landed a valid workflow appends a visible **"I couldn't compose a valid workflow — here's what's blocking it"** notice (streaming) / reply line (non-streaming) + a `workflow_proposal_failed` observation — never silent success, never an apologize-retry loop.
- **WP4 — playbook pointer only.** `build-service.md` gained ONE sentence ("each capability carries its own `stepTemplate` — copy it verbatim"); the authoritative schema comes from context (WP2), not prose. Playbook is a DB row → reseed required post-merge (`demo/seed-firm-admin-skills.ts`).

## The SECOND axis (surfaced by acceptance B): gate-transition vocabulary
Acceptance B (drive the builder-authored workflow) first FAILED: the matter stuck at the entry stage. Same disease, different field — an edge's `via` (attorney/client) / `on` (system) must be an EXACT action/event token the runtime dispatches on (`clientDelivery.ts:59` matches `e.via === actionKind`), but the builder was never told the tokens, so it wrote prose (`via: "Client submits intake…"`) and even wrong punctuation (`invoice_paid` vs `invoice.paid`) — a workflow that renders + approves but never advances. Fix = the identical pattern: new PURE `lifecycle/gateTransitions.ts` (the single catalog: client via ∈ {booking.create, document.upload, client.message.post}, system on ∈ {invoice.paid, esign.completed, transcript.received}, attorney via ∈ {legal.matter.advance, draft.approve}, automatic = free-form), surfaced in `get_workflow_context.gateTransitions` and enforced in `validateProposedLifecycle` with a machine-readable error naming the token + allowed set. **Pinned to the real dispatch call sites by a unit test** (`gate-transition vocabulary` describe) rather than refactoring the 6 handlers — respects "do not touch the runtime execution path"; the test fails if a dispatcher's token diverges from the catalog. Enforcement is authoring-only (`validateProposedLifecycle`, not `validateLifecycle`) so legacy/manual graphs with other tokens are never rejected.

## Decisions (non-obvious rationale)
1. **Generate the example through a `CapabilityStepConfig`-typed literal, not a raw object** — the wrapper keys (`capability_slug`/`capability_config`) live in ONE type; a future rename breaks this build, so the shown example can't drift from what the validator/runtime read.
2. **Two-strike cap, not N.** With errors that name the exact path, a valid emission should land in ≤1 correction; a 2nd failure means the model is guessing, so refuse rather than loop. The cap is the *honest-failure* mechanism, not a retry budget.
3. **Gate vocabulary pinned-by-test, not by refactor.** True single-source would import the catalog constants into the 6 dispatch handlers, but that touches the runtime path the brief froze. A pinning test gives the same anti-drift guarantee (CI fails on divergence) with zero runtime-file churn. Tradeoff logged: a NEW dispatch kind added without updating the catalog degrades safely (the builder just won't offer it), it doesn't break execution.
4. **No migration.** The contract is free jsonb already populated by CAPABILITY-RUNTIME-1's seed; nothing new is stored. (Frontier note: 0119 is taken-but-unstamped by booking #305; this session claimed no migration.)

## ACCEPTANCE — receipts (sandbox `00000000-0000-0000-00fe-000000000001`, real Opus model; harness `demo/workflow-authoring-1-sandbox-run.ts`)
Every substrate row `tenant_id = …00fe…0001`. The harness inlines assistantChat's own Claude-branch orchestration (the REAL `buildAttorneyClientTools` / `get_workflow_context` / `propose_workflow` / `validateProposedLifecycle`) only to read back `failedWorkflowAttempts` — the signal that proves "first correct emission," which the `assistantChat()` wrapper return can't distinguish from a fail-then-self-correct.

**A — THE PROOF.** "NC Contractor Contract Drafting & Review" built BY CONVERSATION to a LANDED workflow (`workflowDefinitionId 48621e13…`, v3), `A_failedWorkflowAttempts = []` (**first correct emission, no trial-and-error**), `A_proposalCount = 1`, `revalidation.ok = true`. 7 stages, **3 `invoke_capability`** = `[ai_document_review, request_client_materials, ai_document_review]`, every config correctly nested (`capability_slug` + `capability_config.{rubric|message}`), every edge a REAL token (`document.upload` / `draft.approve` / `legal.matter.advance` / `invoice.paid`).

**B — RUN IT.** Matter `0536d39f…` driven through the BUILDER-AUTHORED graph: `intake → first_ai_review → request_materials → second_ai_review → send_invoice → await_payment → complete` (**7-turn money shot to terminal**). `memoCount = 2`, both `reasoning_trace_id` NOT NULL (`3b3faedb…`, `bbf23e04…`), client-gated advances via `document.upload`, `invoice INV-2026-0004`, final state `complete`. (Autorun fires ai_document_review on entry but can't read Storage in-sandbox → parks re-invocable; the manual invoke with injected bytes stands in for the window/route trigger, exactly as `caprt1-sandbox-run.ts`. request_client_materials autorun needs no Storage and runs clean.)

**C — NEGATIVE (one-round correction).** Asked to name the key `slug` not `capability_slug`, the model REFUSED and explained the key is exact per the stepTemplate (renaming breaks execution), then proposed correctly: `C_failedWorkflowAttempts = []`, `C_proposalCount = 1`, `correctedInOneRound = true`. The strong context prevented the divergence outright — better than a one-round recovery.

**D — HONEST FAILURE.** Forced-invalid graph called 3×: `failedAttemptCount = 2`, `capturedCount = 0`, 2nd call warned "last allowed attempt", 3rd was REFUSED without re-validating. No silent success, no loop.

**E — GENERALIZATION.** Seeded a trivial 2nd invocable capability `demo_echo_note_*` (complete authoring contract, **zero playbook prose** — the fixture is never named in build-service.md) and asked for a workflow using it: the builder composed a VALID `invoke_capability` step referencing it (`usesFixtureCapability = true`, `capabilitySlugUsed == fixtureSlugSeededThisRun`, `revalidation.ok = true`, zero failed attempts) — proving the self-describing mechanism generalizes to any new capability, not an invoke_capability special-case.

**Local gate:** `typecheck` ✓ · `lint` ✓ · `format:check` ✓ · `build` ✓ · `test:unit` (adds `capability-authoring` — 22 cases incl. the gate-transition pinning + diagnostics).

## Post-merge / remaining
- **Reseed the playbook** (`demo/seed-firm-admin-skills.ts`) so prod runs the new `build-service.md` sentence (a DB row until reseeded) — the schema itself rides context, so this is a pointer refresh, not the fix.
- The `send_invoice → await_payment` attorney "Continue" edge the model chose (`via: legal.matter.advance`) is valid but means an attorney must click Continue after approving the invoice; a firm that wants auto-progress can revise. Not a defect — an authoring choice the vocabulary now makes explicit.

## Files
`verticals/legal/src/lifecycle/{capabilityAuthoring(new),gateTransitions(new),index}.ts` · `verticals/legal/src/api/{workflowAuthoring,workflowAuthoringTools,assistantChat}.ts` · `verticals/legal/skills/firm-admin/build-service.md` · `tests/vertical/{capability-authoring(new),build-wizard-dormancy}.test.ts` · `package.json` · `verticals/legal/demo/workflow-authoring-1-sandbox-run.ts (new, committed — no Storage/service-role ref, storage-guard-safe like caprt1-sandbox-run.ts)`.

---

# WORKFLOW-AUTHORING-1-MERGE (2026-07-08) — merge #308, refresh the prod playbook pointer

## 1. Merge
- PR #308 was CONFLICTING when this session opened (main had advanced to `09fc287` via #306 OVERLOAD-HANDLING-1 + #307 BOOKING-CALENDAR-VIEW-1). **The only conflict was one line** — `package.json`'s `test:unit` (main added `overload-handling.test.ts`, #308 added `capability-authoring.test.ts`). Reconciled by keeping BOTH (normal hygiene, not a force/override); re-ran the full local gate on the merged branch (typecheck ✓ · lint ✓ · format:check ✓ · build ✓ · **test:unit 90/90**, 12 files incl. both new suites), pushed, CI re-ran green (verify + invariants), then **squash-merged via `gh pr merge --squash`** (respects branch protection).
- **Squash SHA `71414bc2d2b7e427940a8e9f5f1680d662d07137`** is the tip of `main`. Feature branch + worktree (`~/dev/exsto-law-workflowauth`) pruned.

## 2. No migration (confirmed)
#308 added no migration. Repo `supabase/migrations_vertical/` top = **0119**; prod `private.vertical_migration` top row = **`0119` (`0119_tenant_public_slug.sql`, applied 2026-07-08T18:50:37Z)**. No 0120 anywhere. Nothing to apply.

## 3. Seed mechanism (diagnostic-first — reported before running)
`demo/seed-firm-admin-skills.ts` is **idempotent UPSERT by slug** through the action layer (`upsertSkill` → `getSkillBySlug` → `createSkill` or `legal.skill.update`). `legal.skill.update` writes **append-only new attribute versions** (substrate supersession — DISTINCT ON `valid_from DESC` picks the latest); **no DELETE, no wipe**. Safe. BUT the full seed re-upserts all 5 firm-admin skills, appending an identical new version to the 4 unchanged ones (bumping their `valid_from`). To honor "touch ONLY build-service," this session ran a **surgical single-skill variant** (a one-off harness, not committed) that upserts only `firm-admin.build-service`.

## 4. Scope (tenant vs canonical)
Skills are **tenant-scoped** — `entity(kind='skill')` + `attribute` rows keyed by `tenant_id` (`queries/skills.ts`, RLS via `withActionContext`). Each tenant has its own row; the builder reads them via `listSkillCatalog(ctx)` (tenant-scoped). `joe@revenueinstruments.com` logs into **Pacheco tenant-zero `00000000-0000-0000-0000-000000000001`**, so the pointer was landed **there** (the LIVE tenant, not sandbox).

## 5. Reseed — live receipt (Pacheco tenant-zero, surgical, append-only)
Upserted ONLY `firm-admin.build-service` (body 20305 → **20498** chars, +193 = the new pointer sentence). Before/after inventory of ALL 5 firm-admin skills:

| slug | body_len before→after | body valid_from before→after | has `stepTemplate` |
|---|---|---|---|
| firm-admin.author-questionnaire | 6065 → 6065 | 15:24:49.485 → **15:24:49.485 (unchanged)** | false |
| firm-admin.author-template | 6625 → 6625 | 15:24:50.514 → **15:24:50.514 (unchanged)** | false |
| firm-admin.author-workflow | 7194 → 7194 | 15:24:51.563 → **15:24:51.563 (unchanged)** | false |
| **firm-admin.build-service** | 20305 → **20498** | 15:24:52.615 → **20:30:25.069 (advanced)** | false → **true** |
| firm-admin.platform-discipline | 4709 → 4709 | 15:24:53.660 → **15:24:53.660 (unchanged)** | false |

Receipt JSON: `target_has_stepTemplate: true`, `target_changed: true`, `other_skills_all_unchanged: true`, `firm_admin_skill_count 5 → 5`. The new sentence is live in the row the builder reads for Joe's login: *"Each capability carries its own `stepTemplate` — the exact `stage.action` JSON to emit for it. COPY it verbatim, only filling in the `<…>` placeholders; never guess the shape or the key names."*

## Acceptance — met
A. #308 squash-merged (`71414bc`) by this session; `main` advanced; branch + worktree pruned; frontier still 0119; no new migration (prod ledger pasted §2). ✓
B. Seed mechanism = idempotent upsert (append-only), NOT destructive; ran the surgical single-skill variant only. ✓
C. `build-service` pointer present + live (`has_step_template=true`) in the correct scope (Pacheco tenant-zero) — row pasted §5. ✓
D. All 4 other firm-admin skills intact — identical `valid_from` before/after, count 5→5. ✓
E. Only tenant-zero written (the intended scope); zero hard deletes (append-only new version). ✓

## Note
Only `firm-admin.build-service` changed content in #308, so only it needed refreshing; the other 4 firm-admin skills already matched their repo source and were deliberately left at their existing versions. The one-off surgical reseed harness was not committed (a prod one-off, like the CAPRT1 harnesses).

---

# RUNTIME-AUTORUN-2 — drafting workflows run end-to-end

Session date: 2026-07-08 · Branch `runtime-autorun-2` · Scope: RUNTIME surface (capabilityRuntime / afterCommit autorun / generate_document producer / advance). No migration; frontier stays **0119**.

## The gap
#303 wired the afterCommit autorun for `invoke_capability` ONLY. A `generate_document` stage never fired on its own — the will/document was drafted only if an attorney clicked "Generate" in the Documents tab. So a builder-authored drafting workflow stranded at `generate_will` (prod matter M-MRCK3A49, Pacheco — READ-ONLY, untouched). The producer had **never run for a will in any tenant** (0 generated docs live), so it was UNPROVEN, not just untriggered.

## A0 — producer proven first (STOP-gate, sandbox `00fe…0001`)
Invoked the real producer (`generateDraft.runDraftGeneration`) for a will directly. It produced a REAL, complete NC Last Will & Testament from template + intake + drafting prompt:
- `document_version` **60f6c8c9-2978-449f-a64c-b91b1ef2d062**, `content_blob` `f46ef938…`, docKind `will`, **8554 chars**, status `pending_review`.
- `reasoning_trace` **3047d10e…**, `agent_actor_id = 00000000-0000-0000-0001-000000000004` (#303's actor). ✓
The handler is alive. Only then was the trigger wired. Harness: `verticals/legal/demo/runtime-autorun-2-a0.ts` (committed, storage-guard-safe).

## The fix — class-based producing autorun (not a hardcoded kind)
- `lifecycle/autoRun.ts`: `scheduleCapabilityAutoRun` → **`scheduleProducingAutoRun`**. A `PRODUCING_RUNNERS` registry keyed by `StepActionKind` IS the class; the dispatch never names a kind. Each runner declares `shouldAutoRun(stage, graph)`: `invoke_capability` = always (its runtime self-parks/advances — #303 UNCHANGED); `generate_document` = only when the stage has a `gate:automatic` edge (the "producing + automatic" rule). Non-producing kinds have no runner → never autofire (human gates wait). A future producing kind adds ONE entry.
- `api/generateDocumentRuntime.ts` (NEW): `generateDocumentForMatter` — the generate_document sibling of `invokeCapabilityForMatter`. Resolve stage → idempotency (skip if a draft for the docKind already exists) → produce via `runDraftGeneration` (emits the canonical **`draft.completed`**) → advance the automatic edge via the shared `advanceAutomaticFromStage`. Post-commit only; never on the advance txn (#303 invariant).
- **Completion event = `draft.completed`** (already registered; `derive.ts:97` already uses it for exactly this generate→review hop). The brief named `document.generated`, which does **not** exist as an event kind in any migration — so it is NOT created. No migration; the advance is edge-first (mirrors invoke_capability), so the will edge's cosmetic `on:` string is irrelevant.
- **Cross-tenant actor fix** (surfaced by acceptance): `legal.matter.advance` rejects a `gate:automatic` advance from a non-system actor. The runtime hardcoded tenant-zero's agent actor `…0001…0004`; in any other tenant (sandbox `…00fe…0004`, a 2nd firm) that id resolves to no actor row → treated as human → advance rejected. This branch was never exercised by #303 (all its capabilities were attorney/client-gated). Fix: `advanceAutomaticFromStage` now resolves **the tenant's own** agent/system actor (`resolveTenantSystemActorId`), falling back to the tenant-zero const (so tenant-zero is a no-op). Fixes automatic advances for BOTH producing kinds in every tenant.
- **maxDuration**: the autorun drafts synchronously in-request, so the trigger routes get `maxDuration = 300` (matches `/workflow/invoke` + assistant): client-portal + attorney document-upload routes and both MCP routes (attorney draft.approve/advance, client delivery).

## Acceptance B–F — green in sandbox `00fe…0001` (harness `runtime-autorun-2-acceptance.ts`, committed)
Full forward pass driven ONLY by real client/attorney actions + the autorun (zero manual producer calls). Will document `a6d97101…`, agent-attributed. `state_history` / event audit:

| # | advance | gate | trigger | proves |
|---|---|---|---|---|
| 1 | client_intake → generate_will | client | document.upload | client action |
| 2 | **draft.completed** (will `a6d97101`, ai_draft) | — | — | **producer autofired (B)** |
| 3 | generate_will → review_send_will | **automatic** | **draft.completed** | **producing-autorun advance (B)** |
| 4 | review_send_will → client_response | attorney | draft.approve | **attorney gate WAITED (E)** |
| 5 | **capability.invoked** (request_client_materials) | client | — | **invoke_capability autofired (F/D)** |
| 6 | client_response → complete (terminal) | client | client.message.post | **reached terminal (C)** |

- **B** autofire ✓ · **C** full pass to `complete` ✓ · **D** two producing kinds through ONE class-based scheduler ✓ · **E** attorney gate waits (no autofire past review) ✓ · **F** #303 invoke_capability autorun unregressed, matter completes ✓.
- Unit: `capability-runtime.test.ts` 13/13 (4 new: generate_document fires with automatic edge; does NOT fire attorney-gated review; does NOT fire a producing step with a non-automatic edge; both kinds route through one scheduler). Full `test:unit` 94/94; typecheck + build green.

## Out of scope / follow-ons
- **BILLING** is a BUILDER-authoring concern (the will graph has no invoice stage — the builder never authored one). Autorun cannot fire a stage that isn't in the graph. The pass reaching `complete` without billing is EXPECTED and correct.
- **Existing stranded prod matter M-MRCK3A49** entered `generate_will` BEFORE this fix, so its autorun was never scheduled — it will not retroactively fire. It stays parked + re-invocable (Documents-tab generate, or a manual producer re-trigger) — a prod op, not this PR (READ-ONLY per brief).
- Durable-worker offload of the in-request draft (beyond `maxDuration`) remains the known scale-up follow-on.
