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
