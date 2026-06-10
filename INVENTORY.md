# Exsto inventory

State as of 2026-06-03, branch **`core-substrate`** — the clean, customer-agnostic
substrate intended as the template other AI-native tools are built from. Canonical
dev database is the Supabase project **`exsto-dev`** (`vjpqtzxtxhisbuaerfbb`).

Branches: `core-substrate` (this — clean substrate template) · `substrate-and-legal-wedge`
(full legal example) · `main` (law-firm production fork).

## Substrate — the foundation (built)

- **Migrations `supabase/migrations/0001`–`0019`** applied to `exsto-dev` (58 tables, all
  RLS-enabled). 0001 bootstrap (tenant/actor/action + RLS + append-only) · 0002 core
  registries · 0003 entity/attribute/relationship · 0004 reasoning_trace · 0005
  raw_event_log/content_blob/document_version · 0006 event/judgment/outcome (+registries)
  · 0007 identity & ingestion · 0008 workflow & governance · 0009 temporal & structural ·
  0010 config & capability · 0011 reasoning/verification + action primitives · 0012 enrich
  registries · 0013 worker_job queue · 0014 reasoning_trace append-only · 0015 pgvector
  embeddings · **0016 schema_migration history (invariant 12)** · **0017 append-only
  enforcement (triggers + revokes, 14 tables)** · **0018 bitemporal protection (8 tables)**
  · **0019 anon lockdown + default privileges**.
- **Seed `supabase/seed/0001_initial_data.sql`** — customer-agnostic: Exsto Dev tenant,
  system/founder/second-user/Claude actors, 49 action kinds, 6 entity kinds, 9 attribute
  kinds, 5 relationship kinds, 2 each event/judgment/outcome kinds. No vertical data.
- **`packages/shared`** — `withTenant` (tx + `SET LOCAL app.tenant_id`), types, db pool.
- **`packages/substrate`** — action layer (`submitAction`), HLC, context, query helper.
- **`packages/primitives`** — write handlers for ALL ~50 primitives (entity/attribute/
  relationship/event/judgment/outcome + identity, governance, structural, communication,
  verification, content, ingestion, config `kind.define`); typed APIs; read queries
  (getEntity, getEntityContext, searchEntities, capabilities, per-entity event/judgment/
  outcome lists).
- **`packages/mcp-tools`** — generic substrate tools (`substrate.capability.list`,
  `substrate.action.submit`, `substrate.kind.define`, entity/attribute/relationship/event/
  judgment/outcome/identity, `entity.context`, `entity.search`). ⚠️ also still imports the
  legal tools + `@exsto/legal` (see "Example vertical" + open item below).
- **`apps/mcp-server`** — HTTP MCP transport (`/health`, `/tools`, `POST /mcp`).
- **`workers/runtime`** — Postgres-backed queue (SKIP LOCKED claim, run_at scheduling,
  exponential backoff, dead-letter, telemetry, per-tenant system-actor binding).
- **`tests/invariants/`** — unit (hlc, worker-backoff) + DB-gated (schema-invariants,
  rls-enforcement, append-only, bitemporal, grants, schema-migration-history, roundtrip);
  README maps all 23 invariants. `pnpm build` + full suite green against `exsto-dev`.
- **Bootstrap** — `supabase/config.toml` wires migrations + seed; `pnpm migrate`
  (`supabase db push`), `pnpm seed`, `pnpm db:reset`, `pnpm test:invariants`. CI
  (`.github/workflows/ci.yml`) runs the full suite against a fresh Supabase stack.

## Example vertical (NOT part of the substrate)

`verticals/legal` (+ `apps/legal-demo`, the legal tool files in `packages/mcp-tools`) is a
worked Layer-3 example for Pacheco Law. A new tool deletes it and builds its own — see
`docs/product/01_HOW_TO_START_A_NEW_TOOL.md`.

## Deferred (tracked; not blocking building on the substrate)

- Projection/replay engine (invariant 13) and behavioral tests for the invariants still
  enforced only at schema level (3, 4, 8, 10, 11, 16, 17, 18, 19–21).
- Generic reference app (the DoD dogfood surface) — `apps/legal-demo` is the example, not it.
- OpenTelemetry traces + the 50ms-per-op performance budget.
- Hash-chain computation/verification (columns present, off by default).
- Decoupling the legal tools out of `packages/mcp-tools` (open item; see QUESTIONS.md).

## Open decisions

`QUESTIONS.md` #1–11 + `adr/0037-rls-role-model.md` (apps connect as a non-owner role).
