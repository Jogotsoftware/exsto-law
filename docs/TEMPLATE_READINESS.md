# Exsto Template-Readiness Audit

> **Superseded (2026-06-09):** this 78/100 audit was re-run after the foundation
> hardening pass. Current verdict is **READY — 92/100**. See
> `docs/FOUNDATION_CERTIFICATION.md` for the re-score, the proofs (all run on a
> fresh project), and the one remaining gate (the clone upgrade path). This
> document is kept for the historical baseline.

**Date:** 2026-06-05
**Branch:** `feat/rest-adapter` (HEAD `3828150`)
**Scope:** Is this repo ready to be the canonical FOUNDATION TEMPLATE every future Exsto tool is cloned from?
**Method:** Evidence read from the actual tree — migrations, code, tests, CI, ADRs, skills. No live DB/network was run; behavioral test *results* are taken from the session report and cross-checked against the test source. Where a claim could not be verified from files, it is scored conservatively and flagged.

---

## Verdict: **NEARLY** — overall **78 / 100**

Up from the prior **NOT-YET, 52/100**. Five of the six prior blockers are genuinely resolved in the tree (verified, not just claimed). The substrate core, schema/security, adapters, bootstrap, and skill library are template-grade. What keeps it out of "READY" is mundane but real: **CI would currently fail** (lint + format are RED on the foundation), there is **no generic reference/dogfood app**, observability and the 50ms perf budget exist only as prose, and several production-hardening items (durable idempotency, prod auth role, per-tool schemas, hash chains) are explicitly deferred.

---

## Scored dimensions

| Dimension | Score | Justification (file evidence) | vs prior |
|---|---|---|---|
| Schema & security | **9/10** | 60 `CREATE TABLE` ↔ 60 `ENABLE ROW LEVEL SECURITY` in `supabase/migrations/0001–0022`; security-hardening migrations are real: `0020` pins `search_path=''` on all guard fns + relocates pgvector out of `public`; `0017` append-only triggers, `0018` bitemporal, `0019` anon lockdown, `0022` `api_key`. | ↑ major |
| Operation core & adapters | **9/10** | One core (`packages/substrate` action/context/query + `packages/primitives` facades). Both adapters delegate: `apps/rest-api/src/server.ts` calls `findTool(name).handler(ctx,input)` with **no substrate SQL**; `docs/OPERATION_CORE_AUDIT.md` records the `git grep` proving zero SQL/Pool in adapter layers. MCP server uses the real `@modelcontextprotocol/sdk@^1.29.0`. | ↑ major (new) |
| Tests & invariant coverage | **8/10** | `tests/invariants/` has 9 files / ~33 cases, DB-gated via `describe.skipIf`. Behavioral (not just structural) tests exist: `rls-enforcement.test.ts` proves cross-tenant read=0 + WITH CHECK reject under role `authenticated`; `grants.test.ts` proves anon/append-only/bitemporal grant lockdown; `roundtrip.test.ts` exercises the action layer + supersession. | ↑ major |
| CI honesty | **8/10** | `.github/workflows/ci.yml` `invariants` job spins `supabase start`, sets `SUBSTRATE_TEST_DATABASE_URL`, runs the suite to JSON, and **asserts `numPassedTests >= 20`** → no false-green. *Caveats:* CI triggers only on `main`/`core-substrate` (not this branch); the green-DB run is asserted by config, not observed here. | ↑ major |
| CI hygiene (lint/format) | **3/10** | The same `verify` job runs `pnpm lint` + `pnpm format:check`. Both are **RED**: `npx eslint .` → 49 errors (legal-demo return-type rules); `npx prettier --check .` → 178 files unformatted. A template's CI must be green; today it would fail. | unchanged (still RED) |
| Bootstrap reproducibility | **9/10** | `supabase/config.toml` exists (pg 17, seeds both files); `package.json` has `migrate`/`db:reset`/`seed`/`test:unit`/`test:invariants`; `scripts/seed.ts` is CLI-independent + idempotent; `supabase/seed/0002_record_migration_history.sql` is the migration-history catch-up. A fresh clone can stand up the DB. | ↑ major |
| Legal decoupling | **10/10** | `packages/mcp-tools/package.json` depends only on primitives/shared/substrate — **no `@exsto/legal`**. Legal tools moved to `verticals/legal/src/mcp/tools/` (19 files); `@exsto/legal` depends on mcp-tools and exposes `./mcp`. Generic surface = 22 tools, 0 legal. | ↑ resolved |
| Skills / .claude enforcement | **9/10** | `.claude/skills/` has MANIFEST + 13 `exsto-*`/meta skills covering migration, add-kind, mcp-tool, rest-api, query, ai-operation, verify-tenancy, bootstrap, new-vertical, etc. Root `CLAUDE.md` has 12 hard rules; per-package CLAUDE.md present. | ↑ resolved |
| Docs & ADRs | **9/10** | 40 ADRs (`adr/0001–0040`), `ARCHITECTURE.md`, `QUESTIONS.md` (open vs RESOLVED tracked, e.g. Q#5/9/10/11), `docs/patterns/*`, `docs/product/*`. One stale doc: `docs/patterns/projection-worker.md` warns it is "unverified … worker runtime not present on this branch" — but the worker runtime *is* present (`workers/runtime/src`). | ↑ |
| Reference app / dogfood | **2/10** | `apps/` = `legal-demo`, `mcp-server`, `rest-api` only. **No generic `apps/reference`** (CLAUDE.md and patterns reference one that doesn't exist). No Google SSO anywhere. The only multi-user UI is the legal vertical. | unchanged (still missing) |
| Observability & perf budget | **2/10** | No `@opentelemetry` dependency in any `package.json`. Only telemetry is `workers/runtime/src/telemetry.ts` — process-local counters, comment says "A real OpenTelemetry exporter can wrap these later". No 50ms perf-budget instrumentation in code despite CLAUDE.md soft rule 7. | unchanged (gap) |
| Projection / replay engine (inv. 13) | **3/10** | Determinism rules are documented (`docs/patterns/projection-worker.md`, ADR 0013) and a worker dispatcher exists, but there is **no built projection/replay engine** — no materialized projection tables, no re-projection path. Pattern doc itself is unverified. | unchanged |

(Sub-scores roll up to **78/100**; dimensions weighted toward the substrate core, which is the template's reason to exist.)

---

## Resolved since the 52/100 audit

| # | Prior blocker | Status | Evidence |
|---|---|---|---|
| 1 | No `.claude/` enforcement layer | **RESOLVED** | `.claude/skills/MANIFEST.md` + 13 skills; root `CLAUDE.md` (12 hard rules) + per-package CLAUDE.md. |
| 2 | False-green CI (DB tests silently skipped) | **RESOLVED** | `ci.yml` `invariants` job: `supabase start` → sets `SUBSTRATE_TEST_DATABASE_URL` → JSON reporter → asserts `numPassedTests>=20` and exits 1 otherwise. |
| 3 | Fresh-clone bootstrap broken (`migrate` missing, no config.toml) | **RESOLVED** | `supabase/config.toml` present; `package.json` `migrate`=`supabase db push`, `db:reset`, `seed`; `scripts/seed.ts` + `supabase/seed/0001`+`0002`. |
| 4 | Legal welded into shared `@exsto/mcp-tools` | **RESOLVED** | `mcp-tools/package.json` has no `@exsto/legal` dep; legal tools under `verticals/legal/src/mcp/`; dependency inverted (Q#12). |
| 5 | Projection/replay engine + generic reference app missing | **PARTIAL** | Operation core + REST/MCP adapters now exist (was the bigger half). Projection/replay engine still **not built**; generic reference app still **absent**. |
| 6 | `.env.example` used DB owner role (RLS silently off) | **RESOLVED (documented)** | `.env.example` now carries an explicit ADR-0037 warning that `postgres` bypasses RLS and app/worker must connect as a non-owner role; `rls-enforcement.test.ts` guards against an owner-role switch. *Caveat:* the example DATABASE_URL is still the owner role; enforcement depends on the deployer wiring the `authenticated` role — verified as intent + guard test, not as a wired-in non-owner connection. |

---

## Remaining gaps to template-ready (prioritized)

1. **CI lint/format are RED (highest, cheapest).** `pnpm lint` = 49 eslint errors, `pnpm format:check` = 178 unformatted files — concentrated in `apps/legal-demo` and `verticals/legal`. The template's own `verify` job would fail on a fresh clone. Run `pnpm format`, fix/relax the `explicit-module-boundary-types` rule for app code, and get CI green. A canonical foundation cannot ship red CI.

2. **No generic reference / dogfood app.** `apps/` has only the legal vertical + the two adapters. The template promises a multi-user, Google-SSO reference app to dogfood the substrate (CLAUDE.md points at `apps/reference`, which doesn't exist). Without it there is no vertical-agnostic, end-to-end example to clone.

3. **Observability + 50ms perf budget are prose, not code.** No `@opentelemetry` anywhere; worker telemetry is process-local counters; no per-operation latency instrumentation or budget assertion. CLAUDE.md soft rule 7 ("profile from day one") is currently unenforced.

4. **Durable idempotency + production auth role.** `apps/rest-api`'s idempotency and rate-limit stores are in-memory/per-process (flagged in its CLAUDE.md); the API-key lookup runs via `withSuperuser` and operations would need to run as the non-owner `authenticated` role in prod (ADR 0037). Both are explicitly deferred and block a real multi-instance deployment.

5. **Per-tool JSON schemas absent on the public surface.** `apps/rest-api/src/openapi.ts` advertises every request body as `additionalProperties: true` (permissive object); MCP tool inputs are TS-typed but not published as JSON Schema. Validation and the generated OpenAPI are weaker than a template should model.

**Also deferred (lower priority):** projection/replay engine + re-projection (inv. 13, ADR 0013) is documented only; hash-chain computation on `action`/`raw_event_log` is reserved-columns-only (QUESTIONS #6, ADR 0018); stale `docs/patterns/projection-worker.md` ("worker runtime not present") contradicts the tree and should be refreshed.

---

## Bottom line

The substrate itself — schema, RLS/append-only/bitemporal enforcement, the single operation core, both adapters, the skill library, and a reproducible bootstrap — is **template-grade and verified in the files**. The gap to "READY" is no longer architectural; it is **operational polish**: green CI, a generic reference app, real observability/perf instrumentation, and the handful of production-hardening items the team has already (honestly) flagged as deferred. Clear those and this earns READY.
