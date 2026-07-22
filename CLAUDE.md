# Operating instructions for Claude Code in this repository

You are working on Exsto, an operational data substrate exposed via MCP. The architecture is governed by ARCHITECTURE.md, the constitutional document for this project. Read it before making any non-trivial change.

The substrate's purpose is to hold what is true, what was true, who said so, with what confidence, when it was learned, where it came from. The substrate does not have its own opinions. It does not edit history. It does not silently change. Trust in the substrate comes from this commitment being absolute.

## Hard rules

These are non-negotiable. Violating any of them is a regression that gets reverted.

1. **Never write to substrate tables outside the action layer.** All changes to entity, entity_attribute, relationship, event, judgment, outcome, identity_assertion, and other substrate tables go through action handlers. Direct INSERT, UPDATE, DELETE on these tables is forbidden in application code. The action layer lives in `packages/substrate`.

2. **Every query is tenant-scoped.** Postgres row-level security enforces tenant isolation at the database layer. Application code, worker handlers, and MCP tools must always set `app.tenant_id` at the start of every request or job. There is no "admin override" path in production code.

3. **Append-only event tables get no UPDATE or DELETE in production code.** The following tables are insert-only: event, raw_event_log, action, configuration_change, schema_migration, access_log, reasoning_trace, causal_claim, fact_contestation, identity_assertion. Corrections happen via new rows that reference what they correct. (Operational *job* tables — `worker_job` and `migration_job` — are the exception: they are lifecycle tables whose `status` mutates in place and whose history is the stream of events their transitions emit, not append-only rows. See ADR 0039.)

4. **Every fact has provenance.** When writing entity_attribute, relationship, judgment, or outcome, the source is set explicitly. Sources are typed: `human:user_id`, `integration:integration_id`, `agent:agent_id`, `system:reason`. Never write a fact without a source.

5. **Every fact has knowability state.** When writing entity_attribute, set `knowability_state` to one of: `observed`, `observed_null`, `never_observed`, `withheld`, `inapplicable`, `pending`, `stale`, `computation_failed`. Default `observed` for normal writes. The substrate distinguishes "we don't know" from "we know there is nothing" from "we are not allowed to see this."

6. **Every fact has time precision.** When writing temporal values, set the precision indicator (`exact_instant`, `second`, `minute`, `hour`, `day`, `week`, `month`, `quarter`, `year`, `range`, `approximate`, `unknown`). Default to the precision of the source. Never silently upgrade precision.

7. **Every action has intent.** When creating an action row, set `intent_kind` (correction, reflection, adjustment, override, exploration, enforcement, automatic_sync, unknown). Use `unknown` only when truly unknown.

8. **Configuration is data, not code.** New entity kinds, attribute kinds, relationship kinds, workflow definitions, permission scopes are NOT added by code changes. They are added by inserting rows into definition tables (`entity_kind_definition`, `attribute_definition`, `relationship_kind_definition`, `workflow_definition`, `permission_scope_definition`). If you find yourself wanting to hardcode a kind in code, stop and add a definition row instead.

9. **One operation core; clients never touch the substrate directly.** Every client reaches the substrate through the shared operation core (the action/query layer in `packages/substrate` plus the primitives in `packages/primitives`), which enforces tenancy, append-only, provenance, and reasoning. MCP is the primary adapter over that core; a REST/OpenAPI adapter is allowed only as a thin sibling that delegates to the same operations (never its own substrate SQL, never a tenant id taken from the request, never `service_role`) — ADR 0024, ADR 0038. Direct database access is permitted only for workers (in `workers/runtime`), for the action layer itself (in `packages/substrate`), and for migration scripts.

10. **Tests verify invariants.** Before changing any code that touches substrate writes, run the invariant test suite (`tests/invariants/`). If a schema change is necessary, the invariant tests are updated to verify the new schema preserves the invariant.

11. **Worker jobs set tenant context.** Every job execution in `workers/runtime` sets `app.tenant_id` from the job payload before any database operation. The dispatcher enforces this.

12. **Verify on the database.** Confirm claims against the live database, the invariant suite (`tests/invariants/`), or the actual code before asserting that work is done, fixed, or passing — never from prose. A green claim with the DB-gated tests silently skipped is not done. The `.claude/skills/` library carries the how (every skill ends with a concrete Verify check); `exsto-verify-tenancy` and `exsto-workflow` are the entry points.

## Soft rules

Strong defaults. Deviate only with explicit justification in the commit message.

1. **Use existing patterns.** The `docs/patterns/` directory has examples of how to write action handlers, MCP tools, projection workers, primitive additions, invariant tests, and reference app surfaces. Copy from these patterns rather than inventing new ones.

2. **Keep functions small.** If a function is over 50 lines, consider whether it should be split. Substrate code is full of small, composable functions.

3. **Prefer declarative over imperative.** Configuration objects describe what should happen. Engines read configuration and execute. Avoid hard-coded business logic; put it in configuration tables.

4. **Migration up always works; migration down might.** Forward-only migrations in production. Down migrations are useful for local dev but not relied upon for production rollback.

5. **Names matter.** Tables and columns are named precisely. `entity_attribute`, not `attributes` or `attribute_values`. Match the architecture document's terminology exactly.

6. **Comments explain why, not what.** The code says what. Comments explain why a decision was made, especially when the obvious approach was rejected.

7. **Performance budget is 50ms per primitive operation.** Profile from day one. The eventual product (Figma-vibe AI-native business software) requires it. Do not let primitive operations creep above this budget without an ADR explaining why.

## Files to read before making changes

If you're working in:

- `supabase/migrations/` → Read ARCHITECTURE.md sections on Layer 1 invariants and Layer 2 primitives, and ADR 0026 (Supabase Postgres as substrate database).
- `packages/substrate/` → Read ARCHITECTURE.md in full. This package enforces every invariant.
- `packages/primitives/` → Read ARCHITECTURE.md sections on Layer 2 primitives.
- `packages/mcp-tools/` → Read `docs/patterns/mcp-tool.md` and ADR 0024 (MCP as primary interface).
- `apps/mcp-server/` → Read ADR 0024 (MCP as primary interface).
- `apps/reference/` → Read `docs/patterns/reference-app-surface.md` and `docs/product/02_LAYER_0-2_DEFINITION_OF_DONE.md` (the reference app section).
- `workers/runtime/` → Read ADR 0027 (Worker runtime from day one).

## When uncertain

If you are uncertain whether a change is consistent with the architecture, stop and ask. Don't guess. The cost of a few minutes of clarification is far less than the cost of architectural drift.

If you encounter a situation the architecture document does not cover, that is a signal that either the architecture document needs updating or you are misinterpreting it. Either way, surface the question rather than improvising.

## Working with the founder

The founder of this project (Joe) has not written code professionally. He has architectural depth at the conceptual level but relies on you for implementation. When explaining technical decisions to him in chat, use plain language. Engineering docs, ADRs, and CLAUDE.md files (including this one) can be technical. Inline code comments can be technical.

When introducing a new concept, give the simple explanation first, then offer to expand if he wants more depth.

When in doubt about a design decision, present the tradeoffs in plain language and ask. Do not silently pick.

## Workflow expectations

The repo is set up to work with Anthropic's Claude Code plus two community plugins:

- **Superpowers** (obra/superpowers via Claude Code marketplace) provides brainstorming, planning, TDD, code review, and worktree workflows. Activate them when their pattern fits.
- **wshobson/agents** provides a catalog of specialized subagents (architect-review, code-reviewer, security-auditor, database-architect, etc.). Use them when their specialty matches the task.

Project-specific subagents live in `.claude/agents/`. The first one is `invariant-auditor`. Add new ones only when their workflow has been done manually enough times to encode it.

Project-specific skills live in `.claude/skills/` — the substrate skill library every clone inherits (`.claude/skills/MANIFEST.md` is the index). Consult the relevant `exsto-*` skill before substrate work: schema changes (`exsto-substrate-migration`), new concepts (`exsto-add-kind`), MCP tools (`exsto-mcp-tool`), reads (`exsto-query-substrate`), AI actions (`exsto-ai-operation`), tenancy/verification (`exsto-verify-tenancy`), a new tenant (`exsto-bootstrap-tenant`), a new vertical (`exsto-new-vertical`). Standing up or shaping a new platform: `newplatform`, `starterprompt`.

## Opening a PR (parallel-session hygiene)

Many Claude sessions work in parallel and a **merge manager** integrates every PR into a fast-moving `main` (each merge auto-deploys to Netlify). Branches that ignore the rules below cost the manager a reconcile or a full CI round-trip per PR. Follow them so your PR lands green and conflict-free:

1. **Run the full local gate before you push — every time.** CI's `verify` job is `typecheck` + `lint` + `format:check` + `build` + `test:unit`. The single most common red PR in this repo is **unformatted code**: run `pnpm format` (prettier write) and, at minimum, `pnpm lint && pnpm typecheck` before pushing. A prettier-only failure wastes an entire CI cycle. Lint is strict — explicit return types on exported functions, no unused vars (prefix intentional ones with `_`).

2. **Base your PR on `main`.** CI only triggers for PRs whose base is `main` or `core-substrate` (see `.github/workflows/ci.yml`). A PR **stacked on another feature branch gets no CI at all and cannot merge** — base on `main` directly, or retarget + reconcile once the base lands.

3. **Pick migration numbers AND kind ids against both `main` and prod.** Parallel branches collide constantly on vertical-migration numbers and on kind ids (entity/attribute/relationship/action/event). Before choosing, check the highest number in `git ls-tree origin/main supabase/migrations_vertical/` AND the prod ledger (`private.vertical_migration`) + existing kind ids, then number **above both**, use a **fresh id-block** (never another branch's block — same `kind_name` at a different id still collides), and write inserts as `ON CONFLICT (id) DO NOTHING`. Follow `exsto-substrate-migration`. Never run `pnpm migrate:vertical` against prod from a feature branch — prod migrations are gated and applied by the manager.

4. **Keep your branch mergeable.** When `main` moves under you, merge it in (or rebase) and resolve conflicts yourself — keeping BOTH your changes and what landed. Smaller, focused PRs reconcile far more cleanly than large ones that touch hot files (e.g. `verticals/legal/src/api/assistantChat.ts`, `apps/legal-demo/app/globals.css`).

## Beta feedback — claim before you start, close the loop when you ship

Beta feedback is captured as `assistant.turn` events (`kind = 'feedback'`) in the substrate — each carries `category`, `page_context.path`, and the message/reply. (The old `feedback.recorded` kind is unused; ignore it.) Most of the work this product is shipping comes from this backlog, and it drifts out of date — reading as all-open — unless every session both claims what it picks up and closes the loop on what it ships.

**Before you start — claim it.** Many sessions run in parallel and keep picking up the same item (this has caused real collisions, e.g. two sessions independently building the same `task` primitive). Before working a feedback item, call `legal.assistant.feedback_backlog` (MCP) to see what is already taken, then `legal.assistant.feedback_claim { feedbackEventId, claimedBy: '<your branch>' }` so other sessions skip it — and `legal.assistant.feedback_release` if you abandon it. Status is three-state: **open → in_progress (claimed) → resolved** (migration 0089). The branch list alone is not enough; claim on the item so the signal lives where the backlog is read.

Then, two required steps whenever a change addresses a feedback item:

1. **Reference it in the commit.** Add a `Beta-Feedback:` trailer listing the `assistant.turn` event id(s) — e.g. `Beta-Feedback: a436b8c6, 86bc2170` (append `(partial)` if it only partly addresses the item). This makes the code↔feedback link greppable: `git log --grep=<id>`.

2. **Resolve the event the same session you ship it** — through the action layer (hard rule 1; never a raw INSERT into `event`): `legal.assistant.feedback_resolve` (MCP) or `resolveAssistantFeedback(ctx, { feedbackEventId, summary, note? })` from `@exsto/legal`. Resolving is what removes the item from the open backlog; a shipped-but-unresolved item looks open and gets re-worked by another session.

Claim up front, then do both of the above when you ship — they're not interchangeable. To see what's still open, read the unresolved `assistant.turn` feedback rows.

**Resolve any item you can verify is shipped — you do not have to be the session that shipped it.** There is no "resolution belongs to the shipping session" rule (it was removed 2026-07-06; it left verifiably-fixed items reading as open for weeks). If you confirm an item is addressed on `main` — a `Beta-Feedback:` trailer, a matching commit, or the behavior in the code/live app — resolve it through the action layer with a `summary`/`note` pointing at the PR. The only bar is verification, not authorship. Duplicates of the same fix all get resolved.

## Shipping new functionality — keep the chatbot/builder awareness log current

The AI assistant (attorney chat + client-portal chat) and the service builder only know what their own tool schemas, merge-token catalogs, and capability registry expose — they do **not** automatically learn about new functionality just because it landed on `main`. Left unchecked this drifts silently: `docs/design/assistant-actions/INVENTORY.md` (the FI-1 census, #457) is already stale in places days after being written, because ordinary feature PRs kept shipping without anyone checking whether the assistant/builder needed to be taught about them.

**Before you merge a PR that adds any of the following, ask whether the assistant/builder needs to know about it:**

- a new MCP tool / action-layer op (`verticals/legal/src/mcp/tools/*.ts`)
- a new entity/attribute/relationship kind whose value a template or the attorney chat might reasonably reference (e.g. a new client-contact fact)
- a new per-service or per-template configuration knob (a toggle, a signer/field binding, a language variant) that a service or template could plausibly need
- a new capability/workflow-step type

Concretely, check: does `buildAttorneyClientTools`/`buildClientPortalTools` (`api/assistantChat.ts`, `api/clientAssistantChat.ts`) need a new/updated `ClientTool`? Does the new fact belong in `MERGE_SLOT_FIELDS`/`SYSTEM_TOKENS` (`api/templateMerge.ts`, `api/tokenClasses.ts`) so a template can merge it? Does a chat-authoring tool's JSON schema (e.g. `propose_service`, `propose_template`) need a new field to let the AI set the new knob — remember `additionalProperties: false` means an unlisted field is silently unreachable from chat, not just undocumented? Does `seed-capabilities.ts` need a new capability entry so the builder can compose it?

**If it's cheap (a Wave-1 shape — additive, low blast radius), wire it in the same PR.** If it needs more design (confirmation UX, security-sensitive, or genuinely undecided), don't block the feature PR on it — instead **append one dated bullet** to a new "Newly opened gaps" log at the bottom of `docs/design/assistant-actions/INVENTORY.md`, in the shape: `- YYYY-MM-DD (#PR): <what shipped> — <what's missing: ClientTool / merge token / capability entry> — <file:line pointer>.` This is the same discipline as the beta-feedback backlog above: log it once, at the moment you have full context, so the next session working the chatbot/builder has a queue to work from instead of re-auditing the whole codebase from scratch.

Periodically (or when explicitly asked to check chatbot/builder coverage), a session should sweep the log, close entries that got wired up elsewhere, and fold anything that's grown into a real wave of work back into the INVENTORY.md gap map proper.
