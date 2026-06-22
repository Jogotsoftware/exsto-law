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

## Beta feedback

User beta feedback (legal clone) is stored as `assistant.turn` events with `kind = feedback` in the substrate; each carries the stable event id shown to the submitter as their reference id. Whenever a commit completes — fully or partially — a beta-feedback item, **two things are required**:

1. **Reference the feedback in the commit message.** Add a `Beta-Feedback:` trailer listing the `assistant.turn` event id(s) the commit addresses, e.g. `Beta-Feedback: a436b8c6, 86bc2170` (short ids are fine). This makes the code↔feedback link greppable forever (`git log --grep=<id>`), so a future session can tell what actually shipped from git history instead of re-deriving it from PR titles. If a commit only partially addresses an item, say so (`Beta-Feedback: <id> (partial)`).
2. **Resolve it through the action layer, same session.** Call `legal.assistant.feedback_resolve` (MCP) / `resolveAssistantFeedback` — never a raw INSERT into `event` (hard rules 1 & 3). It records an append-only `assistant.feedback_resolved` event and pings the submitter's nav bell. Resolution is irreversible (there is no un-resolve), so only resolve what you are confident shipped; use a terse, code-free `summary` (a few words — the bell truncates ~35 chars).
