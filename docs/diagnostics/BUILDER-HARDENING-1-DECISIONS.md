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
