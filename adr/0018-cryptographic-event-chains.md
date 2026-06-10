# ADR 0018: Cryptographic event chains, per-tenant configurable

## Status
Accepted

## Context
A system of record's audit trail is only as trustworthy as its tamper-resistance. If a sufficiently privileged actor can edit the event log directly in the database, the audit trail is just another set of rows that can be rewritten.

Hash chains, used in blockchains and various audit systems, solve part of this problem. Each event includes a hash of the previous event's content. Tampering with any event invalidates the hash chain from that point forward. The tampering becomes detectable.

Not every tenant needs this. For most use cases, append-only enforcement plus database-level access controls are sufficient. For compliance-heavy use cases (financial, healthcare, legal), cryptographic chains add a verifiable layer.

## Decision
The substrate supports cryptographic event chains. Per-tenant configurable: a tenant can opt in to cryptographic chaining for one or more event tables.

When enabled for a table:

- Each new row computes `previous_hash` as the SHA-256 hash of the previous row's content (canonicalized).
- Each row's content includes its `previous_hash`. The chain links forward.
- Periodically, the latest hash is published to a tenant-chosen anchor (an external timestamping service, a customer-controlled storage, or just a second database). The anchor is the witness.
- Verification reads the chain forward, recomputing hashes, and confirms that no tampering occurred since the last anchor.

Default: the schema is present from day one (every event-bearing row has a `previous_hash` column), but verification and anchoring are off by default. Tenants enable per requirement.

The implementation lives in `packages/substrate`. Anchoring strategies are pluggable.

## Consequences

What's now easier:
- Compliance positioning. A tenant in a regulated industry can verify their audit trail.
- Trust. The substrate's claims about history are cryptographically verifiable.

What's now harder:
- Writes for chained tables incur a hash computation. Negligible per-row cost.
- Anchoring requires operational effort. A tenant choosing an external timestamping service must manage credentials and verify the anchor periodically.
- Schema evolution for chained tables is constrained. Changing column structures invalidates old hashes unless canonicalization handles the transition. Migrations of chained tables require careful design.

## Alternatives considered

**Always on.** Considered. Adds cost for tenants who don't need it. Per-tenant opt-in is the right default.

**Always off.** Rejected. The schema must be present from day one to support tenants who need it. Adding hash columns later is a major migration.

**Hash chain at the database level (Postgres extension).** Rejected. Application-level chaining gives more control over canonicalization and anchoring strategy.

**External witness only (no internal chain).** Rejected. The internal chain is what makes verification fast and structured. The witness is one piece; the chain is the other.
