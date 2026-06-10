# Exsto Foundation Certification

**Date:** 2026-06-09
**Certified base:** `main` @ `64202d6` (stack #6–#15 merged) + the hardening on
`cert/foundation-certification` (this PR).
**Verdict:** **READY for cloning** — overall **92 / 100** (was NEARLY, 78/100).
**Method:** every claim below was executed against a **genuinely fresh Supabase
project** (`exsto-clone-final`), not asserted from prose. Re-runnable harnesses are
named so the proofs can be reproduced.

---

## What was proven, and how

### 1. The foundation clones hands-free (clean-room)

A brand-new Supabase project received all **25 migrations via `supabase db push`**
(the real clone path), then `pnpm seed`, with **zero manual fixes**. This is the
proof the migration-history fix (#15) and the three new migrations (0023–0025)
clone cleanly.

| Check | Result |
|---|---|
| `db push` 0001–0025 | applied hands-free, no errors |
| `pnpm seed` | ok (tenant zero + generic kinds) |
| Invariant suite (`pnpm test:invariants`) | **33 / 33** |
| Security advisors | **0** |
| Migration ledger (public = CLI) | **25 = 25** |
| Tables / RLS | 61 tables, **0 without RLS** |
| Seed kinds | generic only: `contact, deal, document, location, organization, person` |
| anon table grants | **0** (fully locked) |

> Method note: an earlier attempt to reuse a project via in-place `DROP SCHEMA
> public` was rejected as non-faithful — it loses Supabase's baseline table grants
> that the lockdown migrations build on. The certified run is on a pristine
> project, which has those grants pre-configured. This is itself a finding: a
> "clone" must be a fresh project, never a wiped one.

### 2. Adversarial pass — 25 attacks, 0 successful violations

`docs/ADVERSARIAL_AUDIT.md`. DB layer (14) as `anon`/`authenticated`/`service_role`
via direct SQL; adapter layer (11) against live REST + MCP bound to the non-owner
`authenticated` role. Cross-tenant reads/writes, forged tenant args/headers,
append-only UPDATE/DELETE, sealed-row edits, idempotency abuse, malformed payloads,
rate-limit flooding — all blocked.

- **One P0 found and fixed during the audit:** `anon` retained `SELECT` on substrate
  tables (read defense was GUC-dependent). Fixed in `0023_anon_read_lockdown.sql`
  (REVOKE ALL from anon + default privileges); re-run confirmed; regression-guarded
  in `tests/invariants/grants.test.ts`.
- Harnesses: `scripts/adversarial-audit.mjs`, `scripts/adversarial-adapters.mjs`.

### 3. Client-grade operations

| Item | What shipped | Proof |
|---|---|---|
| **Durable idempotency** (3a) | `idempotency_key` table (migration 0025) replaces the in-memory map; replay/dedupe/mismatch logic, RLS-scoped, fixpoint claim | adversarial R5 (replay → one action) + R6 (key reuse, different body → 422) |
| **Least-privilege auth** (3b) | API-key lookup moved off `withSuperuser` to SECURITY DEFINER fns in a non-exposed `private` schema (migration 0024), called as `authenticated`; ADR-0037 role binding via `SUBSTRATE_DB_ROLE` | parity green under `authenticated`; advisors 0 (fns not reachable via PostgREST) |
| **Observability** (3c) | OpenTelemetry spans on the operation core (`submitAction`, `executeQuery`) + worker dispatcher; opt-in OTLP export (`startTracing`, on when `OTEL_EXPORTER_OTLP_ENDPOINT` set) | `scripts/perf-budget.mjs` |
| **Perf budget** (3c) | Measured, not asserted | substrate **compute p50 ≈ 26ms (write action), ≈6ms (query)** — both **under 50ms**. Wall-clock (218/134ms) is WAN-bound: ~21ms RTT × 8–9 round trips from this client to us-east-1. Budget is a co-located target; CI's local stack is where it is strictly validated. |
| **Backup/recovery** (3d) | `docs/RECOVERY.md` | exsto-dev plan = WAL-G daily physical, no PITR, in-place native restore. Logical backup (60 tables / 272 rows) restored into a disposable project; **invariant suite 33/33 on the restore**. Tool: `scripts/logical-backup-restore.mjs`. |

### 4. Layer-2 cleanups

- **Per-tool JSON schemas (4a):** all **22 tools** carry an `inputSchema` (one source
  of truth in `@exsto/mcp-tools`); both the MCP `tools/list` surface and the
  generated OpenAPI render it. Replaces the permissive `additionalProperties: true`
  surface.
- **Deferred invariants (4b):** **ADR 0041** documents exactly why invariants 13
  (projection/replay) and 18 (hash-chain computation) are deliberately shallow,
  what is and isn't enforced, and the concrete trigger to complete each. No
  invariant is silently shallow.
- **DoD amendment (4c):** **ADR 0042** + DoD edit — Huber (AR/credit) is the
  proof-of-life vertical, replacing the generic task/notes reference app.

---

## Re-scored template-readiness audit (was 78/100 → **92/100**)

| Dimension | Was | Now | Why it moved |
|---|---|---|---|
| Schema & security | 9 | **10** | advisors 0, anon fully locked, adversarial audit clean, least-priv auth — all on a fresh clone |
| Operation core & adapters | 9 | **10** | durable idempotency, role binding, per-tool schemas, parity green |
| Tests & invariant coverage | 8 | **9** | 33/33 + DB & adapter adversarial harnesses + recovery + perf |
| CI honesty | 8 | **9** | DB-gated suite proven green on a fresh stack (#15) |
| CI hygiene (lint/format) | 3 | **10** | #14 merged; lint 0 / format clean / unit green on the branch |
| Bootstrap reproducibility | 9 | **10** | hands-free fresh-clone of 0001–0025 proven; bootstrap docs corrected |
| Legal decoupling | 10 | **10** | unchanged |
| Skills / .claude | 9 | **9** | bootstrap-doc + newplatform branch references corrected |
| Docs & ADRs | 9 | **10** | ADR 0041/0042, certification, recovery, adversarial audit added |
| Reference app / dogfood | 2 | **8** | reframed by ADR 0042 (Huber is the dogfood); obligation transferred, soak not yet discharged |
| Observability & perf | 2 | **8** | OTel instrumented + opt-in export + perf measured with real numbers; full metrics/dashboards still future |
| Projection/replay (inv 13) | 3 | **5** | now a documented, trigger-bound deferral (ADR 0041), not a silent gap |

Weighted toward the substrate core, these roll up to **92/100 — READY**. The
remaining points are deliberate deferrals (inv 13/18), the not-yet-discharged Huber
soak, and full observability dashboards — none of which block cloning.

---

## The ONE remaining gate before client cloning

**The clone upgrade path.** This certification proves a clone can be *created*
hands-free and is correct at creation. It does **not** yet prove how an existing
clone **receives substrate updates** after it has diverged (the client fork has
Layer-3 code; the foundation ships new migrations/ADRs). Before cloning for a real
client, the foundation needs a defined, tested **upgrade/rebase path**: how a fork
pulls new foundation migrations without clobbering its vertical, how migration
numbering avoids collisions between foundation and fork, and a verify step that the
upgraded fork still passes the invariant suite.

That is the next session's work and the last gate. Everything else needed to start
a clone is proven here.

---

## Reproduce

```bash
# fresh project, then from the foundation repo on this branch:
supabase link --project-ref <fresh> && supabase db push --include-all   # 0001–0025, hands-free
DATABASE_URL=<fresh> pnpm seed
SUBSTRATE_TEST_DATABASE_URL=<fresh> pnpm test:invariants                 # 33/33
DATABASE_URL=<fresh> node scripts/adversarial-audit.mjs                  # 14/0
DATABASE_URL=<fresh> SUBSTRATE_DB_ROLE=authenticated node scripts/adversarial-adapters.mjs  # 11/0
DATABASE_URL=<fresh> SUBSTRATE_DB_ROLE=authenticated node scripts/perf-budget.mjs
SOURCE_URL=<src> node scripts/logical-backup-restore.mjs backup b.json   # recovery drill
```

---

# FOUNDATION STATUS — COMPLETE

**Version:** v1.0.0 (tag `v1.0.0`, pushed)
**Commit:** `cd77ebf` (main)
**Date:** 2026-06-10
**Reference instance:** `exsto-dev` (`vjpqtzxtxhisbuaerfbb`) — migrations 0001–0026, stamped foundation v1.0.0, invariants 33/33, advisors 0, anon grants 0, ledger 26 = 26.

The substrate foundation is **complete and ready to clone.** Every gate is passed:

| Gate | Evidence |
|---|---|
| **Certification** | clone test (hands-free), adversarial pass (25 attacks, 0 violations), client-grade ops (durable idempotency, least-priv auth, OTel + 50ms budget, backup/restore), readiness **92/100 READY** — `docs/FOUNDATION_CERTIFICATION.md`, `docs/ADVERSARIAL_AUDIT.md`, `docs/RECOVERY.md` |
| **Upgrade path** | core/vertical migration namespaces, version stamp, hands-free upgrade runner — ADR 0043; `docs/UPGRADE_PATH.md` |
| **Upgrade drill** | success drill (hands-free 1.0.0→1.1.0, vertical untouched) **PASS** + failure drill (broken migration, fail-closed, nothing half-applied) **PASS** |
| **CI** | green on main (`verify` + DB-gated `invariants`, core-then-vertical) |
| **Template** | `Jogotsoftware/exsto` flagged `is_template: true` |
| **Release tag** | `v1.0.0` on `cd77ebf`, pushed — clones sync against this tag (ADR 0043) |
| **Money convention** | settled before any money vertical — ADR 0044 (amounts as decimal strings, assets as entities, `money_to_numeric`) |

## /newplatform readiness checklist (next session — exsto-law)

Stand up the first client clone with the `newplatform` skill. Each step is already
wired; this is the exact sequence:

1. **Clone the template** — `gh repo create exsto-law --template Jogotsoftware/exsto --private --clone` (carries substrate source, migrations, skills, CLAUDE.md at v1.0.0).
2. **Fresh database** — Supabase MCP `create_project` (us-east-1, its OWN DB; never reuse a foundation DB). It must be a *fresh project*, never an in-place wipe (a `DROP SCHEMA public` loses Supabase's baseline grants the lockdown migrations build on).
3. **Replay CORE migrations** — `supabase db push` (0001–0026). The VERTICAL sequence (`supabase/migrations_vertical/`) is empty and is where exsto-law — never the foundation — authors its schema.
4. **Wire the app** — pull URL + keys into `.env.local`; update project identity (package.json name, README).
5. **Bootstrap tenant zero** — `pnpm seed` (`exsto-bootstrap-tenant`). No half-formed tenants.
6. **Stamp + upgrade remote** — `node scripts/stamp-version.mjs` (records foundation v1.0.0 in `system_capability_registry`) and `git remote add foundation https://github.com/Jogotsoftware/exsto.git` (so it can take future upgrades via `exsto-upgrade-foundation`).
7. **Verify — don't trust** — `SUBSTRATE_TEST_DATABASE_URL=… pnpm test:invariants` (33/33), `get_advisors` = 0, generic seed kinds only, anon 0 grants, ledger consistent.
8. **Hand off** — report what was created + the stamped version; then build the legal vertical (concepts → kinds, operations → MCP tools, app → adapter; author schema ONLY in `supabase/migrations_vertical/`; money per ADR 0044 if it touches money).

**Deferred follow-ups (not gates):** registry publishing as primary distribution (blocked by the `@exsto` scope); a pre-upgrade check that a clone never edited a foundation-owned path. Both documented in ADR 0043.

**The foundation is done. exsto-law is the next session.**
