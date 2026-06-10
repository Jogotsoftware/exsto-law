# ADR 0014: Event tables are append-only

## Status
Accepted

## Context
A system of record's audit story rests on history being preserved. If events can be edited or deleted, a sufficiently determined adversary (or careless developer) can rewrite history without trace. The substrate's value depends on this not being possible.

The core append-only tables are: `event`, `raw_event_log`, `action`, `configuration_change`, `migration_job`, `schema_migration`, `access_log`, `reasoning_trace`, `causal_claim`, `fact_contestation`, `identity_assertion`, and the HLC clock records.

## Decision
Application code never issues UPDATE or DELETE on append-only tables. Corrections are new rows that reference what they correct.

The rule is enforced at multiple layers:

1. **Database policies.** RLS policies for these tables grant SELECT and INSERT only. UPDATE and DELETE return permission errors.
2. **Code review.** Pull requests touching append-only tables are flagged.
3. **Audit on the database itself.** Direct database access (privileged operations) is logged separately and reviewed.

Corrections follow a consistent pattern. A correction is a new row that:
- Has its own ID and recorded_at
- References the corrected row via a `corrects_id` foreign key
- Carries the correction's own action (with `intent_kind = correction`)
- Updates the current-state projection to reflect the correction

The original row remains. Queries that want "current truth" use projections; queries that want "what we thought at time X" use the event log directly with appropriate time filters.

Migrations that need to alter old data follow the same rule: write a new row, never modify the old. Schema migrations themselves are append-only events.

## Consequences

What's now easier:
- Audit. The event log is honest by construction.
- Reproducibility. Replay produces the same state every time.
- Trust. The substrate's claims about history are verifiable.

What's now harder:
- Corrections require effort. A simple "fix the typo" becomes a corrective action plus a re-projection.
- Storage grows monotonically. Old rows are never deleted. Acceptable: storage is cheap, history is the product.
- Some operations that would be simple UPDATEs become more involved. Pattern docs cover the corrective patterns.

Storage management: very old events can be archived to cheaper storage, but never deleted. Archival is itself an event.

## Alternatives considered

**Soft delete on event tables.** Rejected: still permits "hide history." A row marked deleted is not the same as a corrective new row.

**UPDATE allowed for specific fields (e.g., metadata).** Rejected: any allowance creates room for the discipline to slip.

**Append-only enforced only by application convention.** Rejected: convention without enforcement breaks. Database-level policies make the discipline structural.

**Periodic compaction (delete events older than N years).** Rejected: defeats the audit purpose for any tenant whose retention requirements are longer. Archival to cheaper storage is the right model; deletion is not.
