# ADR 0008: Assertion polarity captures positive, negative, and absent observations

## Status
Accepted

## Context
"This deal is not blocked" is different from "we have no information about whether this deal is blocked." Standard schemas conflate the two: both look like an absent or null `is_blocked` field. Downstream consumers cannot distinguish them.

Negative assertions matter for AI reasoning. An agent looking at a deal with no blocker information might infer the deal is fine. The same agent looking at "this deal is explicitly not blocked, asserted by the deal lead yesterday" can reason confidently. The two states deserve different treatment.

## Decision
Facts carry an explicit polarity. The set:

- `positive`: the fact is asserted to be true
- `negative`: the fact is asserted to be false
- `absent`: there is no assertion (different from `negative`; absence of evidence)

Polarity composes with knowability. A `negative` `observed` assertion is a strong claim. A `positive` `never_observed` assertion is a contradiction (something a lint can catch). An `absent` `never_observed` is ordinary "we don't know."

For boolean-like attributes, polarity replaces the standard pattern of "use NULL for unknown, true for yes, false for no." The new pattern: a positive observed assertion is yes, a negative observed assertion is no, an absent or never_observed state is unknown.

For relationship-like facts ("X reports to Y"), polarity allows recording "X explicitly does not report to Y," distinct from "we have no opinion on whether X reports to Y."

For judgments, polarity allows "this customer is not a credit risk" as a recorded judgment, distinct from "no judgment exists."

## Consequences

What's now easier:
- Negative knowledge is representable. "We checked, this person is not at this company" is a fact, not an absence.
- AI reasoning improves. Agents distinguish "asserted false" from "no information."
- Compliance use cases. "We affirm this is not the case" is recordable.

What's now harder:
- Every assertion provides polarity. The default for typical writes is `positive`.
- Queries that filter on truthy values must specify polarity. "Show me deals that are blocked" is `polarity = positive AND attribute = is_blocked`.
- Negation is no longer free. Application code must know that "absent" and "negative" are different.

## Alternatives considered

**Use null/false/true and accept the conflation.** Rejected: standard practice but breaks the AI reasoning use case.

**Three-valued logic at the SQL level.** Postgres has a partial three-valued logic for nulls, but it is inconsistent and confusing. Rejected as a model.

**Polarity as a separate fact about a fact.** Rejected: too indirect. Polarity is a property of the assertion, stored on the assertion row.

**Skip negative assertions; require restating positives.** Rejected: cannot represent "we explicitly checked." This is information that matters.
