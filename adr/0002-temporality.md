# ADR 0002: Bitemporal time on every fact

## Status
Accepted

## Context
The substrate is a system of record. AI agents operating on it need to answer questions like "what did we believe was true on May 15?" and "when did we learn that this fact was no longer true?" Single-timestamp models cannot distinguish "when did this become true in the world" from "when did our system learn this." Without that distinction, audit and reconstruction queries silently lie.

Most operational software conflates these two times. A status field on a deal is updated when someone clicks; the timestamp records when the click happened. If the deal actually closed two weeks earlier and somebody is just now updating the system, the timestamp is wrong about the world. Reports built on it are wrong. AI agents trained on it learn the wrong patterns.

## Decision
Every fact-bearing row in the substrate carries four time fields:

- `valid_from`: when the fact became true in the modeled world
- `valid_to`: when the fact stopped being true (NULL if still current)
- `occurred_at`: when the underlying event happened (for events)
- `recorded_at`: when the substrate learned about it (set automatically on insert)

For attributes (e.g., `entity_attribute`), `valid_from` and `valid_to` define the period during which this value held. For events, `occurred_at` is when the event happened in the world; `recorded_at` is when it landed in the substrate.

Queries default to "current truth as of now": `WHERE valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`. Historical queries override the default explicitly: "what did we believe on date X" uses `recorded_at <= X`; "what was actually true on date X" uses `valid_from <= X AND (valid_to IS NULL OR valid_to > X)`.

## Consequences

What's now easier:
- Audit reconstruction. "What did we know on May 15" is a query, not a forensic exercise.
- Late-arriving information. A fact learned today about something that happened last month gets recorded with an honest `valid_from` of last month.
- AI training. Models train on what was actually true, not on what got typed in.
- Correction handling. A correction inserts a new row with new `valid_from`; the old row gets `valid_to` set. History is preserved.

What's now harder:
- Every write decides what `valid_from` to set. Default is "now," but the default is wrong for late-arriving data. Action handlers accept `valid_from` explicitly.
- Indexes on temporal columns are required for query performance. Profiled per table.
- Joins across temporal data must respect time. Naive joins return wrong answers. Helper functions in `packages/substrate` make temporal joins the default.

## Alternatives considered

**Single timestamp (created_at only).** Standard practice. Rejected: cannot distinguish "what was true when" from "what was recorded when."

**Two timestamps (created_at, updated_at).** Slightly better. Rejected: still cannot represent "this fact was true from June to August," only "this row was last touched at X."

**Event sourcing only.** Truth derived from event log; current state computed. Considered: this is essentially what we do for the event log itself, and projections do the rebuild. But operational queries need fast access to current state with bitemporal context, which requires materialized rows. We use both: events are the source of truth, projections give bitemporal current state.

**Bitemporal at the application layer (compute time-bounded views on demand).** Rejected: forces every consumer to understand the model. Putting the four fields on every row makes the model native to the substrate.
