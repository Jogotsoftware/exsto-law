# ADR 0003: Time precision is a first-class property

## Status
Accepted

## Context
Source data arrives at varying precisions. A meeting log has minute-precision timestamps. A press release has day precision. A historical filing might have only quarter precision. A user might say "sometime last summer."

If the substrate records everything as a precise `timestamptz`, false precision propagates. A field that says "2024-09-15 00:00:00 UTC" is indistinguishable from "actually happened at midnight UTC on September 15" and "we know it happened in September 2024 and the database picked the 15th by default." AI agents reasoning about this data will treat both as identical, leading to confidently wrong outputs.

## Decision
Every temporal value carries a precision indicator. The set of precisions:

- `exact_instant`: known to sub-second
- `second`: known to the second
- `minute`: known to the minute
- `hour`: known to the hour
- `day`: known to the day
- `week`: known to the week
- `month`: known to the month
- `quarter`: known to the quarter
- `year`: known to the year
- `range`: a value with start and end where the actual time is somewhere within
- `approximate`: a fuzzy point ("around mid-2023")
- `unknown`: time is required by the schema but not known

For attributes, events, and any other temporal field, the precision is stored alongside the value. The substrate refuses to silently upgrade precision.

Queries that filter on time consider precision. A query for events "this week" includes day-precision events from this week, hour-precision events with hours in this week, and excludes month-precision events whose month spans more than this week unless the user explicitly opts in.

UIs displaying temporal values render the precision honestly. "September 2024" displays as such, not as "September 15, 2024." This discipline carries into AI reasoning: when an agent generates a summary, it cannot claim more precision than the underlying data.

## Consequences

What's now easier:
- Honest reporting. A timeline of events shows what we actually know, not what default values pretend.
- AI reasoning. Agents can reason explicitly about uncertainty in time.
- Source ingestion. Data from sources with mixed precisions can be ingested without lossy normalization.

What's now harder:
- Every write provides precision. Default is "the precision of the source," which puts the burden on ingestion adapters to know and report it. The action layer requires it explicitly.
- Display logic must understand precision. UI helpers render values per their precision.
- Time-range queries must consider precision. A "between June 1 and June 30" query must decide how to handle quarter-precision events whose quarter spans those dates.

## Alternatives considered

**Truncate to lowest common precision.** Rejected: loses information and produces misleading equality. A day-precision event and a minute-precision event look the same when both are stored as midnight.

**Precision as a separate metadata column on each table.** Rejected: doesn't scale across the many time fields some primitives carry. The precision lives next to the time value as a paired column for that specific field.

**Precision as a JSONB metadata blob.** Rejected: queries over precision become awkward. First-class typed columns allow indexes and constraints.

**Defer precision to Layer 4.** Rejected: retrofit is impractical. Adding precision after data exists means choosing defaults for legacy rows, which produces the same "false precision" failure we are trying to avoid.
