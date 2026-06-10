---
name: exsto-verify-tenancy
description: Prove tenant isolation, append-only history, and bitemporal protection actually hold on a live Exsto database — RLS isolation tests plus append-only/seal audit queries. ALWAYS consult this after a substrate migration, before claiming a schema change is safe, when bootstrapping or cloning a project, or whenever you need to confirm "no cross-tenant reads, no anon writes, no history edits."
---

# Verifying tenancy & history integrity

Trust in the substrate is the product. A claim that isolation "should" hold is worthless — you verify it against a real Postgres with RLS engaged, because mocks bypass the very mechanism being tested. This skill is the negative-test discipline: try the thing that must be impossible (cross-tenant read, anon write, UPDATE on a log, DELETE on a sealed fact) and prove it fails.

## Run against a real DB, as a non-owner role

The invariant suite lives in `tests/invariants/` (Vitest). DB-touching tests are gated:

```typescript
const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const run = describe.skipIf(!url);   // skips (not fails) when no DB is wired
```

Set `SUBSTRATE_TEST_DATABASE_URL` to the target project, then `corepack pnpm test` (pnpm is not on PATH — use corepack). Tests connect with `pg`, then **`SET LOCAL ROLE authenticated`** and `set_config('app.tenant_id', $1, true)` inside a transaction they `ROLLBACK` — never as owner/`service_role`, whose BYPASSRLS would hide isolation bugs. Seeded tenant `00000000-0000-0000-0000-000000000001`; use a foreign id like `99999999-9999-9999-9999-999999999999`.

## The four checks every clone/migration must pass

1. **Cross-tenant read returns nothing.** As tenant A, `SELECT` for tenant B's rows → 0 rows.
2. **Cross-tenant write is rejected.** As tenant A, `INSERT ... (tenant_id = B)` → RLS `WITH CHECK` rejects.
3. **Append-only tables reject UPDATE/DELETE.** Insert an `action`/`event`, attempt UPDATE and DELETE → both raise `append-only violation ... (invariant 14)` from the `zzz_append_only` trigger.
4. **Bitemporal facts reject hard delete + sealed edits.** On `attribute`/`relationship`/`judgment`/`outcome`: DELETE raises `no hard delete`; updating any column but `valid_to` raises `bitemporal close only`; editing a row whose `valid_to IS NOT NULL` raises `sealed row immutable`.

Copy the shape from `tests/invariants/rls-enforcement.test.ts` and `append-only.test.ts`.

## Standalone audit queries (no test runner)

```sql
-- (a) Every public table has RLS enabled — expect zero rows
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;

-- (b) anon has no write grants — expect zero rows
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE grantee='anon' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');

-- (c) Append-only + bitemporal protection triggers are present
SELECT tgname, tgrelid::regclass FROM pg_trigger
 WHERE tgname IN ('zzz_append_only','zzz_no_delete','zzz_seal_guard') ORDER BY 2;

-- (d) Migration ledger matches the files on disk
SELECT count(*) FROM public.schema_migration WHERE entry_kind='migration';
```

## Gotchas

- **`skipIf` means a missing DB silently skips.** A "green" run with no `SUBSTRATE_TEST_DATABASE_URL` proved nothing. Confirm the DB-gated tests actually ran.
- **Don't test as the owner.** The migration role bypasses RLS; the whole point is to test the role apps actually use (`authenticated`).
- **Match the error, not just "throws."** Assert the invariant-named message (`invariant 14`, `bitemporal close only`) so a setup bug can't masquerade as a pass.

## Pointers to ground truth

- `tests/invariants/` (`rls-enforcement.test.ts`, `append-only.test.ts`) and its README mapping the 23 invariants.
- `supabase/migrations/0017`–`0019`; `docs/patterns/invariant-test.md`; ADRs 0001, 0014; `adr/0037-rls-role-model.md`.

## Verify

The suite is the verification. A clean bill of health = audit queries (a) and (b) return zero rows, (c) lists the `zzz_*` triggers on every append-only/bitemporal table, (d) equals the migration count, and the DB-gated `tests/invariants/` run **executes** (not skips) and is green.
