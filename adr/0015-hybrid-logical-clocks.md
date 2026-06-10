# ADR 0015: Hybrid logical clocks for causal ordering

## Status
Accepted

## Context
Concurrent writes from different sources (UI submissions, integration syncs, agent actions, scheduled jobs) need to be ordered consistently. Wall-clock timestamps fail because clocks on different machines drift. Two events stamped within milliseconds of each other from different machines may have the wrong order if we trust wall clocks alone.

Pure logical clocks (Lamport timestamps) capture causality but lose wall-clock context, which makes time-range queries painful. Pure wall clocks lose causality. Hybrid logical clocks (HLCs) combine both: a tuple of (wall-clock time, logical counter) that increments to preserve causal ordering while staying close to physical time.

The substrate needs HLCs for projections (which depend on consistent ordering), for distributed ingestion (multiple workers writing concurrently), and for any future scaling that involves multiple substrate instances.

## Decision
Every event-bearing row includes a hybrid logical clock value: `(physical_time, logical_counter, source_id)`.

HLC rules:

- On every event, the producer reads the current HLC, increments it according to HLC rules, and stamps the event.
- Physical time uses `now()` (UTC, microsecond resolution).
- Logical counter increments when two events would otherwise share the same physical time.
- Source ID breaks ties among logically concurrent events deterministically.
- HLC is monotonically non-decreasing within a tenant. The substrate maintains the latest HLC per tenant.

The HLC implementation lives in `packages/substrate`. All writes through the action layer get HLC values automatically.

For querying, HLC is the canonical ordering for events. UIs that show "events in chronological order" use HLC, falling back to physical time only for human-readable display.

For projections, events are processed in HLC order. This is what makes projections deterministic across re-runs.

## Consequences

What's now easier:
- Concurrent ingestion. Multiple workers can write events without coordinating; HLC ordering resolves conflicts.
- Projection determinism. The order events are processed is fixed.
- Causal queries. "Did A happen before B" has a deterministic answer.

What's now harder:
- Every event-producing path goes through the HLC machinery. Bypassing it produces orderings that disagree with the rest of the system.
- HLC values are not human-readable timestamps. UIs must convert for display.
- Distributed ingestion across multiple writers requires careful HLC handling. The current single-writer-per-tenant assumption simplifies this; multi-writer support is deferred.

## Alternatives considered

**Wall-clock timestamps only.** Rejected: clock skew breaks ordering. Easy bugs.

**Lamport timestamps (pure logical clocks).** Rejected: lose physical time. Time-range queries become awkward.

**Vector clocks.** Considered. Stronger guarantees about concurrent writes. Overkill for the current model. Adds storage overhead. Can be added later if multi-writer scenarios demand it.

**Database-supplied sequence numbers.** Postgres `SERIAL` or `BIGSERIAL`. Considered. Works within a single database but ties ordering to a single Postgres instance. Loses portability across substrate instances if we ever need that.
