# ADR 0007: Knowability state distinguishes ignorance from emptiness from privacy

## Status
Accepted

## Context
"Null" in a database is overloaded. A null value can mean "we never asked," "we asked and there is no value," "the value exists but we are not allowed to see it," "the value doesn't apply to this kind of thing," or "the data was supposed to be there but failed to load." Software treating all nulls as equivalent produces wrong analysis. A report counting customers with no industry recorded is meaningless if some have an industry but the field was never populated and others are explicitly classified as "no industry."

For AI agents, the distinction matters more. An agent that doesn't know whether a fact is missing because nobody asked or missing because it doesn't exist will hallucinate or refuse to act. Either failure is bad.

## Decision
Every attribute carries an explicit knowability state. The set:

- `observed`: we have a value
- `observed_null`: we explicitly observed that the value is empty (a customer with no website)
- `never_observed`: we have not asked or sourced this attribute
- `withheld`: the value exists but the current actor is not authorized to see it
- `inapplicable`: the field doesn't apply to this entity (a person doesn't have a tax filing status if they aren't a business)
- `pending`: we are in the process of acquiring this; the value is not yet present
- `stale`: we used to have a value but it is too old to trust
- `computation_failed`: a derived value's computation errored

Queries that look like "filter to rows where this attribute is set" must specify whether they mean `observed`, or `observed OR observed_null`, or other combinations. The default for "is this attribute populated" is `observed`.

UIs render knowability states distinctly. "Industry: not recorded" is visually different from "Industry: explicitly none."

Action handlers writing attributes provide knowability state explicitly. The default is `observed` for normal writes, but writers can set otherwise (an integration that sees the field is blank in the source records `observed_null`; an agent that lacks permission records `withheld` if it knows there's something there).

## Consequences

What's now easier:
- Honest reports. Counts of "missing data" mean what they claim.
- AI agent reasoning. An agent can distinguish "I should ask" from "I should not assume there is something."
- Privacy modeling. `withheld` lets the substrate represent "this exists but you can't see it" structurally, without the awkwardness of pretending nothing exists.

What's now harder:
- Every attribute write provides a knowability state. The action layer requires it.
- Application code must handle multiple states gracefully. Pattern docs cover the common cases.
- Migrations of legacy data must classify nulls. The migration's choice (likely `never_observed` for most existing nulls) becomes a recorded fact.

## Alternatives considered

**Use NULL with separate "explicitly none" markers per attribute.** Rejected: doesn't scale, requires per-attribute conventions. The set of states is the same across all attributes, so a uniform column is cleaner.

**Knowability inferred from row absence.** Rejected: doesn't capture `observed_null`, `withheld`, `inapplicable`, `stale`, `computation_failed`.

**Smaller set of states.** Considered: could collapse `pending` and `computation_failed` into "transient absence." Rejected after thinking about the AI agent use case; agents need to distinguish "we're working on it" from "we tried and failed."

**Knowability as JSONB metadata.** Rejected: makes filtering expensive. A typed enum column with constraints is the right shape.
