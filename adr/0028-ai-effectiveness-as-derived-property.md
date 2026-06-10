# ADR 0028: AI effectiveness is derived from existing primitives, not a separate primitive

## Status
Accepted

## Context
A core question for any system that includes AI agents: how do we know the AI is doing well? What's the feedback loop?

Effective AI agents need the substrate to capture: what the agent did and why (action plus reasoning_trace), what the human response was (the next action, possibly contesting), and what the eventual real-world outcome was (the outcome record).

If those three things are connected, AI effectiveness is computable: how often did the agent's high-confidence claims correspond to good outcomes? How often were its claims contested? Where did its confidence calibration break down?

The temptation is to add a dedicated "AI effectiveness" primitive: a table tracking AI scores, performance metrics, calibration data. This would be wrong. AI effectiveness is not a thing in the world; it is a derived property of the substrate's existing facts. Building it as a separate primitive creates a parallel system that diverges from the underlying truth.

## Decision
AI effectiveness is computed from existing primitives. No dedicated AI tracking system.

The primitives that support AI effectiveness analysis:

- `action`: every action records the actor, intent, autonomy tier, reasoning trace
- `reasoning_trace`: every agent action's reasoning is captured (ADR 0020)
- `causal_claim`: causal links between actions, judgments, and outcomes (ADR 0019)
- `fact_contestation`: when claims are disputed (ADR 0021)
- `outcome`: realized results, linked back through causality
- `judgment`: qualitative assessments, including AI predictions

Effectiveness queries are SQL against these primitives:

- "How often did agent X's high-confidence claims hold up?" Joins `action` (filtered to agent X), `reasoning_trace` (for confidence), and contestation or outcome records.
- "What's the calibration of agent X across different judgment kinds?" Aggregates predicted vs actual outcomes grouped by `judgment_kind`.
- "Show me cases where agent X's reasoning was contested." Joins reasoning traces with contestation records.

The MCP server can expose canned versions of these queries as tools. UIs can render dashboards from them. None of this requires new primitives.

The reference app's AI feedback flow (the "good," "wrong," "wrong because" buttons in the chat surface) creates judgments and contestations. These are the same primitives any other feedback would use; the chat surface is just an entry point.

## Consequences

What's now easier:
- Single source of truth. AI effectiveness reflects what actually happened, not a parallel scoring system.
- Adding new effectiveness metrics is a query, not a schema change.
- Contesting a metric is the same as contesting any fact: a `fact_contestation` row.

What's now harder:
- Effectiveness queries can be complex. The substrate provides query helpers and pattern docs.
- Calibration analysis at scale may require materialized views or summary tables. These are derivations, not primary data; they get rebuilt from the underlying primitives.
- "Show me how the AI is doing" is not a single query; it's a pattern of queries. UIs that render this take some thought.

## Alternatives considered

**Dedicated AI effectiveness primitive.** Rejected: a separate primitive diverges from the underlying truth. Two sources of "how is the AI doing" are worse than one.

**Periodic snapshot of effectiveness scores into a table.** Considered: useful as a materialized view for dashboards. Treated as a derivation, not a primitive. Can be rebuilt from the underlying data at any time.

**Track effectiveness only for production AI uses, not for development.** Rejected: development is where calibration most needs visibility. Reference app AI usage is a key signal.

**External AI observability tool.** Considered. Tools like LangSmith, Helicone, etc. provide LLM-specific observability. Useful at the model invocation layer (capturing prompts, completions, latency). They are a layer beneath substrate effectiveness analysis. The substrate captures what the AI did to the substrate; an external tool can capture how the model itself performed. Both layers are useful and they don't conflict.
