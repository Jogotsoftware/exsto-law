---
name: exsto-query-substrate
description: Bitemporal reads over the Exsto substrate done right — current-state, as-of, and full history, with knowability, confidence, provenance and polarity preserved. ALWAYS consult this before writing any read against entity/attribute/relationship/judgment/outcome, before adding a read MCP tool or read helper, or whenever you reach for SQL that touches substrate state.
---

# Querying the Exsto substrate

The substrate never overwrites and never forgets, so every read has a *temporal stance*: are you asking what is true now, what was true at time T, or the whole history? Get the stance wrong and you silently read a sealed or stale row as if it were current. Reads also carry the substrate's whole point — knowability, confidence, provenance, polarity — and dropping those columns turns a trustworthy fact into a naked value. This skill keeps reads correct and honest.

## Read as the tenant, never as the owner

Every read runs inside an action context so RLS is engaged and you see your own writes (invariant 16). Use the real helper `executeQuery(ctx, sql, params)` from `@exsto/substrate`, or the typed read functions in `@exsto/primitives`: `getEntity`, `getCurrentAttributes`, `getAttributeHistory`, `listRelationships`, `getEntityContext`, `searchEntities`, `getCapabilities`, `listEventsForEntity`, `listJudgmentsForEntity`, `listOutcomesForEntity`. Never connect as `service_role`/owner to read substrate data — BYPASSRLS reads cross tenants and hide isolation bugs. Tests read as the `authenticated` role (see exsto-verify-tenancy).

## The three temporal stances

Bitemporal fact tables (`attribute`, `relationship`, `judgment`, `outcome`, `stakeholder_position`, ...) use `valid_from` / `valid_to`. `valid_to IS NULL` = currently open.

- **Current state** — the open row per kind: `WHERE valid_to IS NULL`, with `DISTINCT ON (<kind>_id) ... ORDER BY <kind>_id, valid_from DESC` when more than one could be open. This is exactly what `getCurrentAttributes` does.
- **As-of time T** — what was true then: `WHERE valid_from <= $T AND (valid_to IS NULL OR valid_to > $T)`.
- **Full history** — the append-only trail: no `valid_to` filter; `ORDER BY valid_from DESC`. This is `getAttributeHistory`.

Append-only **log** tables (`action`, `event`, `raw_event_log`, `reasoning_trace`, ...) have no `valid_to`; order them by `occurred_at` / `recorded_at` or by HLC.

## Carry the meaning, not just the value

Always select alongside the value: `knowability_state`, `confidence`, `source_type`/provenance, `time_precision`, and (judgments/outcomes) `polarity`. `knowability_state = 'never_observed'` is **not** `observed_null`; a negative-polarity judgment is a real assertion, not a missing one. Don't collapse these in the read or the API will lie. Knowability states: `observed, observed_null, never_observed, withheld, inapplicable, pending, stale, computation_failed`.

## Gotchas

- **"Latest" needs the open filter AND ordering.** A bare `ORDER BY valid_from DESC LIMIT 1` can return a *closed* row if you forgot `valid_to IS NULL` (or didn't bound the as-of). Use `DISTINCT ON` per kind like `getCurrentAttributes`.
- **Keep the tenant predicate.** RLS enforces tenancy, but the helpers still pass `tenant_id = $1` for index use and clarity. Keep it.
- **Don't read "current" definitions for historical work.** Projections / re-projection bind to the definition version current at the event time (ADR 0017) — see `docs/patterns/projection-worker.md`.
- **Search is hybrid.** `searchEntities` is keyword over name + open text attributes; vector search rides on `content_embedding` (migration 0015) when populated.

## Pointers to ground truth

- `packages/primitives/src/queries.ts` — every canonical read; copy its shape.
- `packages/substrate/src/query.ts` — `executeQuery` and read-consistency helpers.
- ADRs 0002 (temporality), 0007 (knowability), 0008 (polarity), 0016 (read consistency).

## Verify

Run a current-vs-history check on a real entity (as the `authenticated` role with `app.tenant_id` set):

```sql
SELECT count(*) FROM attribute WHERE entity_id = $1 AND valid_to IS NULL;  -- current: one per open kind
SELECT count(*) FROM attribute WHERE entity_id = $1;                       -- history: >= current
```

The history count must be ≥ the current count, and every "current" row must have `valid_to IS NULL`. In code, `getCurrentAttributes` and `getAttributeHistory` for the same entity must agree on the open rows.
