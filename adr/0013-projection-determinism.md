# ADR 0013: Projections from raw events to normalized state are deterministic

## Status
Accepted

## Context
The substrate ingests raw events from many sources. Some events are processed inline at write time. Others are projected later by background workers. Projections derive normalized state (entities, attributes, relationships) from the raw event log.

If projections are non-deterministic, the substrate cannot reliably re-derive its state. Re-projection is needed when projection logic changes, when a bug is found, or when migrating between systems. Non-determinism means re-projecting produces different results than the live state, which creates support nightmares.

For AI agents reasoning about substrate history, determinism also matters. An agent asking "what would the substrate look like if we re-applied these events" expects a deterministic answer.

## Decision
Projections are deterministic. Given the same inputs (raw events plus the definition versions that were current when those events were processed), a projection produces the same outputs every time.

Determinism rules:

1. Projections do not call wall-clock-dependent code. They use the event's `occurred_at` and `recorded_at`, not `now()`.
2. Projections do not use random numbers, except seeded ones where the seed is recorded alongside the projection output.
3. Projections do not call external services. If external data is needed, the call happens at ingestion time and the result is recorded as part of the raw event.
4. Projections respect ordering by HLC (see ADR 0015). Two events with the same HLC are ordered deterministically by tiebreaker (UUID, source ID, etc.).
5. Projections bind to definition versions explicitly. A projection from a 2024 event uses 2024-version definitions, not current definitions. The binding is recorded.

Re-projection is a first-class operation. The substrate supports re-running projections from a chosen point in the event log forward, into a temporary table, with comparison to current state. Drift is reported, not silently accepted.

## Consequences

What's now easier:
- Bug fixes. A projection bug can be fixed and old data re-projected.
- Audits. Re-derivation produces verifiable state.
- Migration between systems. An export plus a re-projection elsewhere produces the same result.
- Testing. Projections are pure functions and easy to test.

What's now harder:
- Projections that need external data must capture that data at ingestion. An adapter that wants to enrich with a current API call must record the API response as part of the raw event.
- Time-dependent projections must use the event's time, not the wall clock. Easy to get wrong; pattern docs cover the trap.
- Definition version binding requires bookkeeping. The substrate maintains a version history of every definition.

## Alternatives considered

**Materialized views for projections.** Rejected: Postgres materialized views work for some cases but don't compose with the action layer or capture provenance properly.

**Eventual consistency without re-derivation.** Rejected: cannot fix bugs in projections. State drifts and is unrecoverable.

**Projection results stored as immutable derived events.** Considered. Adds complexity (every projection becomes another event log). The current approach (projections write to current-state tables, with the projection logic being pure) is simpler and sufficient.

**Allow non-determinism in some projections.** Rejected: any non-deterministic projection becomes the foundation for incidents that cannot be reproduced. Worth the discipline to keep all projections deterministic.
