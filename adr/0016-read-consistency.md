# ADR 0016: Read consistency is session-level by default

## Status
Accepted

## Context
A user who writes a value and then reads it back expects to see what they wrote. An agent that records a judgment and then queries for that judgment expects the same. Without read-your-writes consistency, software feels broken: "I just changed it, why doesn't it show up?"

Stronger guarantees (snapshot isolation across all reads, linearizability) come with performance costs. Weaker guarantees (eventually consistent) make the substrate's behavior depend on luck.

For Exsto, the right level is the session: within a session, the user or agent sees their own writes; across sessions, eventual consistency is acceptable for projections.

## Decision
The substrate provides session-level read-your-writes consistency.

Mechanism: each session (HTTP request, worker job, agent invocation) reads the latest HLC at start. Subsequent reads in the session are filtered to events with HLC at or before the latest committed HLC for that session, plus any HLCs the session has produced. This means:

- A session that writes sees its own writes immediately on subsequent reads.
- A session that reads sees a consistent snapshot relative to its own writes.
- Two concurrent sessions may see different versions of substrate state momentarily; this is acceptable.

For longer-running operations (multi-step agent workflows, multi-page UI sessions), the substrate offers a "snapshot session" mode where the HLC at start is held throughout. The session sees a consistent view as of its start, regardless of changes happening elsewhere. Used for analytical workflows where consistency matters more than freshness.

Projections are eventually consistent across sessions but consistent within a session.

The session-level guarantee is implemented in `packages/substrate`. Application code does not handle it; it gets it for free by going through the substrate's query helpers.

## Consequences

What's now easier:
- Read-your-writes works. UIs and agents see their own changes.
- Snapshot sessions provide consistency for analytical work without the cost of global linearizability.

What's now harder:
- Session boundaries must be respected. A request that fans out to multiple workers needs to propagate the session's HLC.
- Cross-session consistency is not guaranteed. A user looking at a dashboard while another user writes will not see the new data immediately. UIs must handle this with refresh or live update mechanisms.
- Long sessions can drift. A snapshot session that lives for hours sees an increasingly stale view. Pattern docs cover when this is acceptable and when to refresh.

## Alternatives considered

**No consistency guarantees (read whatever the database returns).** Rejected: produces "where did my write go" bugs constantly.

**Strong consistency across all reads.** Rejected: performance cost is high. Postgres serializable isolation degrades concurrency under load.

**Per-row consistency tracking.** Rejected: complex without commensurate benefit.

**Causal consistency at the substrate level.** Considered: stronger than session-level, weaker than linearizable. The session-level model captures the user-facing requirement (read-your-writes) and is simpler to reason about.
