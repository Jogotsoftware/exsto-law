# ADR 0005: Every fact has typed provenance

## Status
Accepted

## Context
The substrate holds facts that come from many sources: humans typing in UIs, integrations syncing from external systems, AI agents inferring values, scheduled jobs computing derived state. When a user or an agent looks at a value, the question "where did this come from" is fundamental. Without an answer, trust is impossible.

Most operational software answers this question incidentally, if at all. A `created_by_user_id` column captures human authorship. Integration sources are often not captured at all; data lands in the same column whether a human typed it or a sync wrote it. AI-generated content is a new category that most schemas were not designed for.

For Exsto, AI agents will be reading, writing, and reasoning across the substrate. Their outputs need to be distinguishable from human inputs and from integration syncs. A future reviewer must be able to ask "show me everything Claude wrote in the last week" and "show me everything that came from Salesforce."

## Decision
Every fact-bearing row carries a typed source. The source is required (not nullable) and structured.

Source types:
- `human:<actor_id>`: a human user took an action
- `integration:<integration_id>`: an external system supplied this via an adapter
- `agent:<agent_id>`: an AI agent generated this
- `system:<reason>`: the substrate itself derived this (a projection, a default, a migration)

Every action recorded in the action layer captures a source. Every fact written through the action layer inherits the source. Direct writes to substrate tables (forbidden in application code) bypass this; this is enforced by the action-layer-only-write rule (see ADR 0009).

Source is queryable. "Show me all attributes of this entity sourced from Claude" is a single query. "Compare what Salesforce says about this contact with what Affinity says" is a query.

Source compositions are explicit. When a derived value depends on multiple sources, the action that produced it captures the contributing inputs as a chain. A judgment that uses three attributes records all three as inputs in its `reasoning_trace`.

## Consequences

What's now easier:
- Trust. A value's lineage is queryable.
- Conflict resolution. When two sources disagree, the substrate has both. The conflict is structured, not buried.
- AI auditing. Everything an agent has written is filterable.
- Compliance. "Who said this" has a structured answer.

What's now harder:
- Every write provides source. Action handlers require it; they cannot fall back to a default.
- Source chains for derived values must be captured. Pattern documentation (`ai-action-handler.md`) covers how.

## Alternatives considered

**`created_by_user_id` only.** Standard practice. Rejected: cannot distinguish humans, integrations, and agents. Cannot represent system-derived values without making them look like a fake user.

**Source as a free-form text column.** Rejected: queries become string parsing. Typed sources allow indexes and joins.

**Source as a JSONB blob with arbitrary structure.** Rejected: makes simple queries awkward. The structured `source_type:source_id` pattern is sufficient and queryable.

**Provenance as audit-log-only (not on the rows themselves).** Rejected: audit logs answer "who did what" but not "where did this current value come from" without expensive joins. Carrying source on the row keeps the answer cheap.
