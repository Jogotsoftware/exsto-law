# ADR 0019: Causality is a first-class queryable graph

## Status
Accepted

## Context
Audit logs answer "what happened." Causality answers "why did this happen." For AI agents reasoning about substrate state, "why" is often more important than "what."

Most software does not record causality structurally. A reminder fires; an email is sent. A user accepts a suggestion; a row is updated. The fact that the email was caused by the reminder, or the row was caused by the suggestion, is implicit, recoverable only by joining log entries by time and hoping nothing else fired in the same second.

For Exsto, causal queries are part of the product. "Show me every action that resulted from this AI suggestion." "What chain of events led to this outcome?" "Which contestation caused this fact to be revised?" These questions need first-class structural answers, not log archaeology.

## Decision
Causality is captured as `causal_claim` rows: `(cause_id, effect_id, claim_kind, claimant, confidence, recorded_at)`.

Cause and effect can be any first-class object: an event, an action, a judgment, an outcome, a fact. Claim kinds: `caused`, `contributed_to`, `triggered`, `enabled`, `prevented`.

Causal claims are first-class facts. They have provenance, confidence, contestation. A causal claim can itself be contested ("no, that wasn't actually the cause") which becomes a new claim or a `fact_contestation` row.

Causal queries are a substrate primitive. The MCP server exposes `causality.trace_forward` (given a cause, find effects), `causality.trace_backward` (given an effect, find causes), `causality.path_between` (given two objects, find causal paths). These respect tenancy and permission scope.

For automatic causality capture: any action that is triggered by another action (a reminder firing causes a notification dispatch) records the causal claim automatically. Manual claims (a human asserting "I think this customer's churn was caused by this issue") are recorded explicitly.

## Consequences

What's now easier:
- AI agent reasoning. Agents can ask "why" and get structured answers.
- Outcome attribution. Outcomes link back through causal chains to the events and judgments that contributed.
- Debugging. "Why did this happen" is a query, not a forensic exercise.

What's now harder:
- Every action that has automatic causal links must record them. The action layer captures `caused_by` references when present.
- Causal claims can become noisy. Filtering by confidence and claimant lets queries focus on the strong claims.
- Cyclic causality (A caused B caused A) is possible to record. Queries handle cycles explicitly.

## Alternatives considered

**Causality inferred from time and context.** Rejected: inference is unreliable. Explicit claims are robust.

**Causality only for specific event kinds.** Rejected: too narrow. Any object can have causal relationships.

**Causality as a graph database alongside Postgres.** Considered. Adds operational complexity. Postgres handles graph queries adequately for the substrate's scale (recursive CTEs, ltree extension if needed).

**Implicit causality through workflow definitions.** Workflows already encode some causality (state X transitions to state Y). The `causal_claim` table generalizes this beyond workflows.
