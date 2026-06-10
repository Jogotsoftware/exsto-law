# Exsto Project Structure

**How the substrate gets built. Operating instructions for Claude Code, for the founder, and for any future engineer joining the project.**

---

## Repository structure

The substrate is a single monorepo using pnpm workspaces. Multiple packages live together because they share types, schemas, and tooling. Module boundaries are enforced through directory structure, explicit dependencies, and per-package CLAUDE.md files that tell Claude Code the local rules.

```
exsto/
├── README.md                    Bootstrap instructions: clone, install, env, run
├── ARCHITECTURE.md              Constitutional doc, v2.0
├── CLAUDE.md                    Top-level operating instructions for Claude Code
├── .gitignore
├── .env.example                 Template for local environment variables
├── package.json                 Workspace root (pnpm workspaces config)
├── pnpm-workspace.yaml          Workspace member declaration
├── tsconfig.base.json           Shared TypeScript config; per-package configs extend this
├── .claude/
│   ├── settings.json            Project-scoped Claude Code settings, MCP config, hooks
│   ├── agents/                  Project-specific subagents
│   │   └── invariant-auditor.md First subagent: verifies layer 1 invariants on every change
│   ├── skills/                  Project-specific skills
│   └── commands/                Slash commands for recurring workflows
├── adr/                         One ADR per layer 1 invariant, plus key architectural decisions
│   ├── 0001-tenancy.md
│   ├── 0002-temporality.md
│   ├── ...
│   ├── 0023-extensibility.md
│   ├── 0024-mcp-as-primary-interface.md
│   ├── 0025-monorepo-with-pnpm-workspaces.md
│   ├── 0026-supabase-postgres-as-substrate-database.md
│   ├── 0027-worker-runtime-from-day-one.md
│   └── 0028-ai-effectiveness-as-derived-property.md
├── docs/
│   ├── patterns/                Code patterns Claude Code copies from
│   │   ├── action-handler.md
│   │   ├── ai-action-handler.md
│   │   ├── mcp-tool.md
│   │   ├── projection-worker.md
│   │   ├── primitive-from-scratch.md
│   │   ├── invariant-test.md
│   │   └── reference-app-surface.md
│   ├── operations/              Deployment, observability, runbooks
│   │   └── ...
│   ├── product/                 Vision, layer roadmap, definition of done
│   │   ├── vision.md
│   │   ├── 02_LAYER_0-2_DEFINITION_OF_DONE.md
│   │   └── layer-4-roadmap.md
│   └── learning/
│       └── concepts-to-study.md Running glossary of concepts the founder is learning
├── supabase/
│   ├── migrations/              Forward-only SQL migrations; never modified after merge
│   │   ├── 0001_bootstrap_tenant_actor_action.sql
│   │   ├── 0002_definition_registries.sql
│   │   ├── 0003_core_primitives.sql
│   │   └── ...
│   ├── seed/                    Seed data for local development
│   ├── functions/               Edge Functions for low-volume webhooks (rare)
│   └── CLAUDE.md
├── apps/
│   ├── reference/               Next.js dogfood app (multi-user task and notes)
│   │   ├── app/                 Next.js app router
│   │   ├── components/          UI components specific to the reference app
│   │   └── CLAUDE.md
│   └── mcp-server/              MCP server runnable; supports stdio and HTTP transports
│       └── CLAUDE.md
├── workers/
│   └── runtime/                 General-purpose worker runtime
│       ├── queue.ts             Job queue interface
│       ├── scheduler.ts         Time-based job dispatcher
│       ├── dispatcher.ts        Pulls jobs, sets tenant context, invokes handlers
│       ├── handlers/            Registered handler implementations live here
│       └── CLAUDE.md
├── packages/
│   ├── substrate/               Engine: action layer, RLS context, HLC, hash chain, governance, query helpers, reasoning capture
│   │   └── CLAUDE.md
│   ├── primitives/              7 core primitives + definition registries; library engines for workflow, trigger, rubric, permission scope evaluation
│   │   └── CLAUDE.md
│   ├── mcp-tools/               MCP tool catalog (consumed by apps/mcp-server)
│   │   └── CLAUDE.md
│   └── shared/                  Cross-cutting: types, errors, telemetry, config, db client with tenant binding
│       └── CLAUDE.md
└── tests/
    ├── invariants/              One suite per layer 1 invariant
    ├── primitives/              One suite per primitive
    └── integration/             End-to-end scenarios using the reference app
```

This shape applies a clean line: infrastructure that is hard to add later is in v1; instances of that infrastructure are added when their use cases are real.

## Process boundaries

Three runnable processes. Adding a new process later follows the same pattern.

- `apps/reference` is the Next.js web application. Serves the reference app UI. Calls the MCP server through its HTTP transport.
- `apps/mcp-server` is the MCP runnable. Single source of truth for substrate operations. Used by the reference app, by Claude Code in development, and by any future client.
- `workers/runtime` is the worker process. Pulls jobs from the queue, sets tenant context, invokes registered handlers. Handles time-based scheduling. Reports telemetry.

Library packages (`packages/substrate`, `packages/primitives`, `packages/mcp-tools`, `packages/shared`) are imported by the runnables. They do not run on their own.

## Top-level CLAUDE.md

The repository root has a CLAUDE.md that Claude Code reads when working anywhere in the repo. It sets the operating principles for all work. The full content is in a separate file (`CLAUDE.md` at repo root). Summary of what it covers:

- Hard rules (non-negotiable; violation is a regression that gets reverted)
- Soft rules (strong defaults; deviate only with explicit justification)
- Files to read before making changes in each directory
- When uncertain, stop and ask

## Per-package CLAUDE.md content

Each package has its own CLAUDE.md with rules specific to that package. Drafts below.

### supabase/CLAUDE.md

```markdown
# Working with database schema and migrations

## Migration discipline

Migrations are forward-only in production. Once a migration is merged to main, it is never modified. If a prior migration did the wrong thing, write a new migration that does the right thing.

Filenames: NNNN_descriptive_name.sql, where NNNN is a zero-padded sequential number. Never reuse a number. Never reorder.

## Schema rules

1. Every table has tenant_id. Even configuration tables, capability registries, and definition tables. RLS depends on this.
2. Every table has created_at and updated_at, set by database default and trigger, not application code.
3. Foreign keys are explicit and named. fk_entity_attribute_entity_id is better than autogenerated names.
4. Indexes are deliberate. Don't add indexes "just in case." Add them when query patterns demonstrate need. Document why each index exists in a comment on the migration.
5. Soft deletes use status enums, not deleted_at. The substrate's pattern is temporal validity (valid_to) for state and status enums (active, disconnected) for lifecycle.

## RLS policies

Every table has RLS enabled in production. Policy structure:

CREATE POLICY tenant_isolation ON table_name
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

Application code sets app.tenant_id at the start of every request and worker job. There is no bypass for "admin" users in production code; admin operations use a separate elevated path with explicit logging.

## Append-only tables

These tables get INSERT only in normal operation: event, raw_event_log, action, configuration_change, migration_job, schema_migration, access_log, reasoning_trace, causal_claim, fact_contestation, hybrid_logical_clock_records.

Corrections happen via new rows that reference what they correct.
```

### packages/substrate/CLAUDE.md

```markdown
# The substrate engine

This package enforces the 23 layer 1 invariants. Everything else in the substrate inherits from primitives that obey these invariants because they pass through this package.

## What lives here

- Action layer (the universal write path; every change to substrate state is an action)
- RLS context management (sets app.tenant_id; required at the start of every operation)
- Hybrid logical clock implementation
- Hash chain construction and verification
- Governance gradient evaluation (autonomous, notify, approve, suggest)
- Reasoning trace capture
- Query helpers that respect tenant isolation, knowability state, confidence, provenance
- Read consistency primitives (read-your-writes, monotonic reads, snapshot)

## What does not live here

- Specific entity, attribute, or relationship kinds. These are data, in the definition registries.
- Specific MCP tools. They live in packages/mcp-tools.
- Specific worker handlers. They live in workers/runtime/handlers.
- UI code. Lives in apps/reference.

## Hard rules in this package

1. The action layer is the only write path. There is no internal helper that bypasses it.
2. Every public function accepts a tenant context and a session context. There are no global state writes.
3. Every fact written carries provenance, confidence, knowability, time precision. The function signature requires these explicitly.
```

### packages/primitives/CLAUDE.md

```markdown
# The 7 primitives and their runtime engines

This package implements the 7 core primitives, their definition registries, and the runtime engines that read those registries.

## What lives here

- Entity, attribute, relationship, event, judgment, outcome, action implementations
- Definition registries (entity_kind_definition, attribute_definition, etc.)
- Workflow execution engine (reads workflow_definition rows, runs state machines)
- Trigger evaluation engine (reads trigger_definition rows, evaluates conditions)
- Rubric evaluation engine (reads rubric definitions, evaluates against entities)
- Permission scope evaluation engine (reads permission_scope_definition rows, evaluates authorization)
- Identity assertion handling

## Schema-as-data discipline

New entity kinds, attribute kinds, relationship kinds, workflow definitions, permission scopes are added by inserting rows into definition tables. Never by writing a hardcoded enum, switch statement, or class.

If the temptation arises to hardcode a kind in this package, that is a signal to add a definition row instead.

## Hard rules in this package

1. Every primitive operation goes through the action layer in packages/substrate. No direct INSERT/UPDATE/DELETE on substrate tables.
2. Runtime engines (workflow, trigger, rubric, permission) read definitions at evaluation time and bind to definition versions per invariant 17.
3. Engines are deterministic. Given the same inputs and the same definition version, they produce the same output.
```

### packages/mcp-tools/CLAUDE.md

```markdown
# The MCP tool catalog

Each MCP tool is a single file. Each file exports a tool definition (schema, description) and a handler function.

## Tool design principles

Tools are read-only by default. Tools that write must:

1. Construct an action object
2. Pass it through packages/substrate's action layer (which checks autonomy tier and permission scope)
3. Return the action_id and effects

Tools never write directly to substrate tables.

## Naming and granularity

Tool names follow the pattern: domain.verb.qualifier. Examples:

- entity.list.by_kind
- entity.get.by_id
- attribute.history.get
- judgment.create
- workflow.advance

Each tool does one thing. A tool that "lists or gets" is two tools. A tool that "creates or updates" is two tools.

## Pattern to copy

See docs/patterns/mcp-tool.md for the template. Copy it. Modify only the parts specific to the new tool.
```

### packages/shared/CLAUDE.md

```markdown
# Cross-cutting infrastructure

This package holds the things every other package needs.

## What lives here

- Common types (UUID, TenantId, ActorId, ActionId, EntityId, etc.)
- Error classes (TenancyViolation, GovernanceDenied, ContestationDetected, etc.)
- Telemetry setup (OpenTelemetry tracer, structured logger)
- Configuration loading (env var parsing, validation)
- Database client wrapped to require tenant context binding
- Time precision utilities

## Hard rules

1. No business logic. This package is plumbing only. Business logic belongs in packages/primitives or packages/substrate.
2. No imports from other workspace packages. This package is a leaf in the dependency graph.
```

### apps/reference/CLAUDE.md

```markdown
# The reference app

A multi-user task and notes application. This is the dogfood. It exists to exercise every invariant and every primitive in real daily use.

## What this app is for

- Proving the substrate works end-to-end before any customer touches it
- Surfacing substrate gaps under daily-use pressure
- Demonstrating MCP-as-interface (the chat surface IS the MCP client)
- Providing a stable reference UI when introducing new substrate primitives

## What this app is not for

- Customer use
- Production support
- Marketing or demo material

## Hard rules

1. All data access goes through the MCP server. The reference app does not query Postgres directly. This is the same constraint a customer client would face.
2. Every UI write becomes an action through MCP. The action layer enforces governance.
3. The app uses the same auth path as a customer would (Supabase Auth with tenant binding).
4. New surfaces in this app are always written against existing primitives. If a new surface seems to need a new primitive, that is a substrate question, not an app question.

## Pattern to copy

See docs/patterns/reference-app-surface.md for the template for adding a new surface (a list view, a detail view, a chat tool).
```

### apps/mcp-server/CLAUDE.md

```markdown
# The MCP server runnable

This is the only client-facing interface to the substrate. UIs, agents, integrations, every future surface goes through here.

## What lives here

- Transport setup (stdio for local development with Claude Code, HTTP for production clients)
- Authentication and tenant token validation
- Tool dispatch (calls into packages/mcp-tools)
- Request lifecycle (sets tenant context, runs the tool, captures telemetry, returns response)

## Hard rules

1. No business logic in this package. Tools live in packages/mcp-tools. The server's job is dispatch and lifecycle, not implementation.
2. Every request sets app.tenant_id before any database operation. No exceptions.
3. Every tool execution captures a reasoning_trace if invoked by an agent.
```

### workers/runtime/CLAUDE.md

```markdown
# The worker runtime

A general-purpose worker process. Pulls jobs from a queue, runs registered handlers, reports telemetry. Handlers are added via registration; the runtime does not change.

## What lives here

- Queue interface (initial implementation: Postgres-backed via pg-boss or equivalent; abstraction allows swapping later)
- Scheduler (cron-like, evaluated against the queue)
- Dispatcher (pulls jobs, sets tenant context, invokes handlers, reports outcomes)
- Retry policy with exponential backoff
- Dead-letter queue for permanently failing jobs
- Telemetry emission

## What does not live here

- Specific handler implementations. Those are added in handlers/ as separate files. Each handler is a code drop, not a change to the runtime.
- Ingestion logic. Future ingestion adapters register handlers in handlers/ and live in workers/ingest/ once that exists.
- Identity resolution. Same.

## Hard rules

1. Every job execution sets app.tenant_id from the job payload before any database operation. The dispatcher enforces this; handlers do not see jobs without tenant context.
2. Every job has a deterministic key for idempotency. Re-running a job with the same key produces the same effect.
3. Failures route to the dead-letter queue after retries; they do not silently drop.
```

## Patterns documents

The `docs/patterns/` directory is the secret weapon for working with Claude Code. Each pattern document shows a complete, working example that Claude Code copies.

Each pattern document contains:

1. A short description of when to use the pattern
2. A complete, working code example that can be copied
3. The places where customization is expected (and how to customize)
4. Common mistakes to avoid
5. Related patterns and references to ADRs

Pattern documents to write before construction is far along:

- **action-handler.md.** How to handle write operations through the action layer. Captures intent, autonomy tier, reasoning. Probably the single most important pattern.
- **ai-action-handler.md.** How AI-driven actions go through the substrate, with reasoning capture, governance, and contestation handling. Specialization of action-handler.md for AI actors. See ADR 0028.
- **mcp-tool.md.** How to expose a substrate capability via MCP. Read tool template. Write tool template (which calls action handlers).
- **projection-worker.md.** How to write a deterministic projection from raw_event_log to normalized state.
- **primitive-from-scratch.md.** How to add a new primitive end-to-end: definition registry row, migration if any, MCP tools, reference app surface, tests.
- **invariant-test.md.** How to write a test that fails when an invariant is violated.
- **reference-app-surface.md.** How to add a new UI surface to the reference app, going through MCP.

These patterns are reference material. Claude Code is dramatically better when there's a working example to copy than when it has to invent the pattern.

## Build sequence

The order in which the substrate gets built. No dates, no time pressure, sequence-only.

### Phase A: Foundation

1. Repo bootstrap: pnpm workspace, TypeScript config, ESLint, Prettier, Vitest, CI setup
2. Supabase project provisioned, env vars documented, local development running against it
3. Migration 0001: tenant, actor, action, action_kind_definition tables with RLS
4. packages/shared: types, errors, telemetry, db client with tenant binding
5. Layer 1 invariant test scaffold: empty test files for each invariant, all failing
6. ADRs 0001 through 0023 drafted (one per invariant)

### Phase B: Substrate engine

7. packages/substrate: action layer, RLS context, HLC, hash chain, governance evaluator
8. Migration 0002: definition registry tables (entity_kind_definition, attribute_definition, etc.)
9. Migration 0003: core primitive tables (entity, entity_attribute, relationship, event, raw_event_log, judgment, outcome)
10. packages/primitives: core primitive implementations, all going through the action layer
11. Invariant tests start passing one by one

### Phase C: MCP and runnables

12. apps/mcp-server scaffolded with stdio transport
13. packages/mcp-tools: read tools for entities, attributes, relationships, events
14. workers/runtime scaffolded with queue, scheduler, dispatcher
15. apps/mcp-server gains HTTP transport
16. Capability tools (return what kinds and definitions exist)

### Phase D: Definition completeness

17. Remaining Layer 2 primitives (workflow, trigger, notification route, permission scope, approval, policy, hierarchy, collection, ownership, role, commitment, communication thread, stakeholder position, content blob, document version, configuration change, migration job, schema migration, system capability registry, substrate known issue, reasoning trace, causal claim, fact contestation, access log, subscription)
18. Workflow execution engine
19. Trigger evaluation engine
20. Rubric evaluation engine
21. Write tools through MCP (judgment.create, workflow.advance, attribute.set)

### Phase E: Reference app

22. apps/reference scaffolded (Next.js, Supabase Auth, MCP HTTP client)
23. Authentication and workspace switching
24. Task surface (list, detail, create, edit, complete)
25. Note surface (with version history)
26. Reminder surface (proves the worker runtime fires time-based jobs)
27. Sharing surface (proves role assignment, ownership assignment, permission scope)
28. Activity feed (proves access log and audit trail)
29. Disagreement flow (proves contestation)
30. Chat surface backed by MCP (the dogfood for MCP itself)

### Phase F: Hardening

31. Performance profiling, ensure 50ms budget met for primitive operations
32. Observability dashboards
33. Three-week daily-use period; track and fix substrate gaps
34. Layer 0-2 declared done

## Working rhythm

How the founder uses this scaffolding to build alongside Claude Code.

**Per session.** Start by running tests. Pick the next item from the build sequence. Read the relevant pattern doc. Open Claude Code in the relevant package. Work in a feature branch. Commit incrementally.

**Per feature.** Read the relevant pattern document. Write or extend the relevant package. Add tests. Verify invariants still hold. Commit when green.

**Per architectural decision.** If something does not fit cleanly, stop. Don't improvise. Write an ADR. Decide consciously.

**Weekly.** Run the full test suite including invariant tests. Review what was built against the definition of done. Adjust the build sequence if anything has surfaced that requires it.

## ADR template

Architecture Decision Records document why decisions were made. When a layer 1 invariant or a significant architectural decision needs to be recorded, an ADR is written.

```markdown
# ADR NNNN: Title

## Status
Accepted / Deprecated / Superseded by ADR-XXXX

## Context
What is the situation that requires a decision? What forces are at play?

## Decision
What did we decide?

## Consequences
What follows from this decision? What's now easier? What's now harder? What did we accept as a tradeoff?

## Alternatives considered
What other options were on the table? Why did we reject them?
```

The first 23 ADRs document the layer 1 invariants. They're written before construction begins so the rationale for each is captured before any code commits to it.

## What this document is not

It is not the architecture. ARCHITECTURE.md governs what gets built. This document specifies how.

It is not exhaustive. Patterns documents fill in details. This is the high-level scaffolding.

It is not static. As construction surfaces new patterns and reveals what's missing, the patterns documents grow. The structure stays stable; the patterns evolve.
