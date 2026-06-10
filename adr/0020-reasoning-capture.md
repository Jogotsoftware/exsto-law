# ADR 0020: AI agent actions capture reasoning

## Status
Accepted

## Context
Logging that an agent did something is not enough. Logging the input and output also isn't enough. To trust an agent's actions, and to improve them over time, the substrate needs to capture the reasoning: what evidence was considered, what alternatives were evaluated, what conclusion was selected, what confidence was assigned, what was uncertain.

Without reasoning capture, an agent that does ten right things and one wrong thing is opaque. We can't tell which reasoning produced the wrong answer because we have no visibility into the reasoning. We can't improve the agent because we have no signal about where its reasoning fails.

For Exsto, agent reasoning is also a feedback loop input. Comparing predicted outcomes against actual outcomes (linked through causal claims) requires knowing what the agent thought would happen and why.

## Decision
Every agent-originated action captures a `reasoning_trace`. The trace records:

- `evidence`: what observations were considered, with references to the substrate rows
- `alternatives_considered`: what other actions were evaluated, with brief rationales for rejection
- `selected_conclusion`: what was chosen
- `selected_confidence`: confidence in the conclusion
- `uncertainty`: what the agent is not sure about and would want to verify
- `external_inputs`: any non-substrate inputs (model used, prompt version, retrieval results)

Reasoning traces are first-class rows in `reasoning_trace`. Every action with `actor_type = agent` has a `reasoning_trace_id`. Human actions can also include reasoning traces, but it is not required.

The trace is queryable. "Show me all reasoning traces from agent X in the last week where confidence was below 0.7" is a single query. "Find traces where alternatives included Y but the agent picked Z" is a query.

Reasoning traces feed the AI feedback loop (ADR 0028). When an outcome is recorded, the substrate can look back at the reasoning that led to predictions and assess calibration.

For privacy, traces are subject to the same tenancy and permission scope rules as other facts. A trace that includes evidence from records the current actor cannot see is filtered or denied.

## Consequences

What's now easier:
- Agent improvement. Reasoning traces provide signal about where agents fail.
- Trust. Humans can review agent decisions in detail.
- Calibration. Confidence claims can be validated against outcomes.

What's now harder:
- Every agent action produces a trace. Traces are bigger than action rows. Storage cost is non-zero but bounded.
- Agent code must produce traces. Pattern docs cover the structure.
- Agents that don't produce structured traces (e.g., a model called via a chat interface with no structured output) require wrapping. The wrapper extracts trace components from the model's output where possible.

## Alternatives considered

**Log full prompt and response.** Standard for LLM observability tools. Useful but unstructured. The `reasoning_trace` schema captures the key components in a queryable form.

**Reasoning traces only for high-stakes actions.** Rejected: classification of "high stakes" is itself a judgment that can be wrong. Capturing for all agent actions sets the right default.

**Free-text reasoning field on every action.** Rejected: free text is not queryable without parsing. Structured trace is more useful.

**Defer trace capture to Layer 4.** Rejected: agents will be writing to the substrate from day one through the reference app. Capturing reasoning now is foundational, not deferrable.
