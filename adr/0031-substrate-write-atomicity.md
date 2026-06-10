# ADR 0031: Substrate write atomicity via shared DB client

## Status
Accepted

## Context
The action layer (`submitAction` in `packages/substrate/src/action.ts`) is the only legal write path to substrate tables (CLAUDE.md hard rule). Initially, an action was inserted in one `withTenant` block and then handed off to the registered handler, which opened a *second* `withTenant` block to write its effects. That gave us two distinct pool checkouts and two distinct transactions: if the effect-side write failed, the action row was already committed, leaving an action with no effects. It also meant pool clients carried session settings (`SET app.tenant_id = ...`) past their callback, leaking RLS context across requests.

## Decision

`withTenant(tenantId, callback, { actorId })` opens a single connection, runs `BEGIN`, uses `SELECT set_config('app.tenant_id', $1, true)` and (when supplied) `SELECT set_config('app.actor_id', $1, true)` so the RLS session vars are transaction-local, runs the callback, then `COMMIT` (or `ROLLBACK` on throw). Session settings auto-clear with the transaction; they never leak to the next pool consumer.

`submitAction` wraps both the action insert and the handler invocation in one such transaction. Handlers receive the live `DbClient` (along with `ctx, payload, actionId`) so their effects share the same transaction as the action row. Atomicity is structural: if any effect throws, the action does not commit either.

## Consequences

### What this makes easier
- Action and effects are guaranteed atomic. No partial state on failure.
- RLS context cannot leak across requests, regardless of pool churn.
- The handler signature `(ctx, client, payload, actionId)` makes the connection dependency explicit; handlers cannot accidentally bypass the transaction.

### What this makes harder
- Long-running handler work (Claude calls, external HTTP) inside a transaction holds a connection longer than necessary. We mitigate by doing pre-action work (Claude call, reasoning trace persistence) outside the `submitAction` transaction — only the action row + final substrate writes are inside it.
- Read helpers that want to see the caller's uncommitted writes must run inside the same `withActionContext` callback. We added `executeQuery(ctx, sql, params)` as the canonical read path; for the wedge it is enough.

## Alternatives considered
- Keep separate transactions for action and effects. Rejected because partial commits on failure violate ADR 0009 (auditability) — the action log would imply effects that did not happen.
- Use `SET LOCAL` outside an explicit transaction. Rejected because `SET LOCAL` is a no-op outside a transaction in Postgres; we would silently lose the RLS context.

## Accepted
Yes. Implemented in `packages/shared/src/db.ts` and `packages/substrate/src/action.ts`. All current primitive and legal vertical handlers conform.
