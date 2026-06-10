# Exsto Substrate — Adversarial Security Audit

**Date:** 2026-06-09
**Branch:** `cert/foundation-certification`
**Target:** a disposable Supabase project (`exsto-clone-scratch`) carrying the full
substrate (migrations `0001`–`0025`), seeded with tenant zero + a second tenant.
**Method:** actively try to BREAK the substrate's guarantees as every Postgres role
and through both adapters. Every attempt is run by a re-runnable harness, logged
with its expected vs observed result and a PASS (violation blocked) / FAIL
(violation succeeded) verdict.

- **DB layer** (`scripts/adversarial-audit.mjs`): direct SQL as `anon`,
  `authenticated`, `service_role` via `SET LOCAL ROLE`, always rolled back.
- **Adapter layer** (`scripts/adversarial-adapters.mjs`): REST + MCP driven as a
  hostile HTTP client, with the adapters bound to the non-owner `authenticated`
  role (`SUBSTRATE_DB_ROLE=authenticated`) so RLS is genuinely engaged end-to-end.

## Verdict: **PASS — 25 attacks, 0 successful violations.**

One issue was found and fixed during the audit (finding **A1**, anon read access);
the fix (`0023_anon_read_lockdown.sql`) was applied and the attack re-run to
confirm. No outstanding violations remain.

To reproduce:

```bash
DATABASE_URL=<disposable-owner-url> node scripts/adversarial-audit.mjs        # DB layer
DATABASE_URL=<disposable-owner-url> SUBSTRATE_DB_ROLE=authenticated \
  node scripts/adversarial-adapters.mjs                                       # adapters
```

---

## Threat model & trust boundaries

- **`anon`** — the public/unauthenticated Postgres role (the Supabase anon key).
  Must have **zero** access to substrate tables. The substrate is never read by
  anon directly; clients reach it through the app as `authenticated`.
- **`authenticated`** — the app/adapters' role (ADR 0037). RLS applies; sees and
  writes only its bound tenant; cannot edit history.
- **`service_role` / `postgres`** — carry `BYPASSRLS` (verified in `pg_roles`).
  RLS does **not** constrain them — by design. The defense is that **application
  code never connects as either** (verified by grep: `service_role` /
  `SERVICE_ROLE_KEY` appear only in test harnesses, never in `packages/`, `apps/`,
  `workers/`, or `verticals/` source). The guarantees that MUST hold even for them
  — append-only and bitemporal immutability — are enforced by triggers, which fire
  regardless of role, and are tested below (A13).
- **Adapter principal** — both adapters derive the tenant + actor **server-side**
  (REST: from the API key; MCP: from validated headers) and never from the request
  body or tool arguments (invariant 1, ADR 0038).

---

## DB layer — 14 attacks (`scripts/adversarial-audit.mjs`)

| ID | Role | Attack | Expected | Observed | Verdict |
|----|------|--------|----------|----------|---------|
| A1 | anon | `SELECT` from `actor` (tenant bound) | denied | permission denied for table actor | **PASS** |
| A2 | anon | `INSERT` into `actor` | blocked | permission denied for table actor | **PASS** |
| A3 | authenticated | read own-tenant `actor` rows | >0 (own only) | 4 | **PASS** |
| A4 | authenticated | read tenant B's actor by id (cross-tenant) | 0 rows | 0 | **PASS** |
| A5 | authenticated | `INSERT actor` for another tenant (WITH CHECK) | blocked | new row violates RLS policy | **PASS** |
| A6 | authenticated | `UPDATE action` (append-only) | blocked | permission denied for table action | **PASS** |
| A7 | authenticated | `DELETE action` (append-only) | blocked | permission denied for table action | **PASS** |
| A8 | authenticated | `UPDATE` a sealed `attribute` value | blocked | sealed row immutable … (invariant 14) | **PASS** |
| A9 | authenticated | re-open a sealed `attribute` (clear `valid_to`) | blocked | sealed row immutable … (invariant 14) | **PASS** |
| A10 | authenticated | `DELETE attribute` (no-delete guard) | blocked | permission denied for table attribute | **PASS** |
| A11 | anon | `SELECT` from `api_key` | denied | permission denied for table api_key | **PASS** |
| A12 | service_role | read across all tenants (EXPECTED bypass) | ≥2 (by design) | 2 | **PASS** |
| A13 | service_role | `UPDATE action` (append-only still holds) | blocked | permission denied for table action | **PASS** |
| A14 | authenticated | bound to B, read A's rows (forged binding) | 0 rows | 0 | **PASS** |

Notes:

- **A12 is not a violation.** `service_role` is documented to bypass RLS; the audit
  records it to make the bypass explicit and to pair it with A13, which proves the
  append-only trigger blocks even a BYPASSRLS role. The real control is that the
  app never uses `service_role` (verified above).
- **A8/A9** are blocked by the `zzz_seal_guard` trigger (migration 0018), which
  raises on any modification of a row whose `valid_to` is set — even for the table
  owner. Corrections are new rows, never edits.

---

## Adapter layer — 11 attacks (`scripts/adversarial-adapters.mjs`)

Run with `SUBSTRATE_DB_ROLE=authenticated`, so every operation executes under RLS
as the non-owner role — the production posture (ADR 0037).

| ID | Surface | Attack | Expected | Observed | Verdict |
|----|---------|--------|----------|----------|---------|
| R1 | REST | forged `tenant_id`/`actorId` in body | created under the key's tenant (A) | owner = A | **PASS** |
| R2 | REST | malformed JSON body | 400 | 400 | **PASS** |
| R3 | REST | non-object JSON body (`[1,2,3]`) | 400 | 400 | **PASS** |
| R4 | REST | invalid API key | 401 | 401 | **PASS** |
| R5 | REST | idempotency replay (same key + body) | one action, replayed | identical `actionId` both calls | **PASS** |
| R6 | REST | idempotency key reused with a different body | 422 | 422 | **PASS** |
| R7 | REST | rate-limit flood | 429 | 429 seen | **PASS** |
| M1 | MCP | missing tenant/actor headers | 401 | 401 | **PASS** |
| M2 | MCP | malformed (non-UUID) headers | 401 | 401 | **PASS** |
| M3 | MCP | forged tenant in tool arguments | created under header tenant (A) | owner = A | **PASS** |
| M4 | MCP | cross-tenant read (B reads A's entity) | not visible | not visible | **PASS** |

Notes:

- **R1 / M3** prove the cardinal adapter rule: a client cannot pick its tenant. A
  `tenant_id` in the body or tool args is ignored; the entity lands under the
  authenticated principal's tenant.
- **R5 / R6** exercise the new **durable** idempotency store (migration 0025): a
  replay returns the original action without re-submitting, and a key reused with a
  different request body is rejected (422) rather than served the wrong cached
  response.
- **M4** is an end-to-end RLS proof through the MCP adapter under `authenticated`:
  tenant B cannot see tenant A's entity by id.

---

## Finding A1 (FIXED) — anon retained read access

**Severity:** P0 (by the audit's "any successful violation is a P0" bar).
**Status:** FIXED in `supabase/migrations/0023_anon_read_lockdown.sql`; re-run PASS.

**What was found.** Migration `0019` stripped anon's *write* grants but left
`SELECT` in place, relying on RLS plus "anon cannot set `app.tenant_id`" as the
read defense. The audit set `app.tenant_id` under the anon role and read tenant
rows — showing the read defense was GUC-dependent, not grant-enforced. A
misconfigured data API (exposing `app.tenant_id`) or the app ever connecting as
anon would leak tenant data.

**Why it was safe to fix.** No source path reads the substrate as the anon
Postgres role: the browser uses the anon key for auth only; all substrate reads go
through the MCP/REST adapters as `authenticated`. (`grep` for `createClient` /
`.from(` / `anon` over `apps/*/src`, `packages`, `verticals/legal/src` found no
anon table reads.)

**The fix.** `REVOKE ALL ON ALL TABLES/SEQUENCES IN SCHEMA public FROM anon` plus
`ALTER DEFAULT PRIVILEGES … REVOKE ALL … FROM anon`, making the lockdown
grant-enforced (belt) on top of RLS (suspenders) and reproducible for tables added
later. After applying: anon has **0** table grants; A1 re-run = denied (PASS).

**Regression guard.** The grant-level lockdown is asserted by
`tests/invariants/grants.test.ts` (extended to require zero anon privileges of any
kind on public tables).

---

## What this audit does NOT cover (out of scope / deferred)

- **Application-level authZ beyond tenancy** (per-actor permission scopes,
  governance gradients) — schema present; enforcement is per-vertical and not
  exercised here.
- **Cryptographic hash-chain tamper detection** (invariant 18) — reserved columns
  only; deliberately deferred (see ADR 0041). The seal/append-only triggers, not
  the hash chain, are what block tampering today, and those are tested (A6–A10).
- **DoS / resource exhaustion** beyond the per-tenant rate limiter (R7).
- **Secrets management and transport security (TLS)** — deployment concerns.
