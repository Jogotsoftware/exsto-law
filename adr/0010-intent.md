# ADR 0010: Every action carries explicit intent

## Status
Accepted

## Context
Two writes that look identical at the row level can mean very different things. Editing a deal's amount because someone fat-fingered the original entry is a "correction." Editing the same field because the deal was renegotiated is an "adjustment." Editing it because a test was running is an "exploration." Editing it because a human authority overrode an automated calculation is an "override."

These differences matter for downstream consumers. Reports that exclude corrections (because they're noise) include adjustments (because they're real changes). AI training that learns from real actions excludes explorations and corrections. Compliance review attends to overrides. Without typed intent, all four look the same.

## Decision
Every action carries an `intent_kind`. The set:

- `correction`: fixing a previous mistake (the prior value was wrong as recorded)
- `reflection`: recording an observation about something that already happened
- `adjustment`: a real change in the underlying world being reflected
- `override`: deliberate action against an automated or default behavior
- `exploration`: speculative or testing action; not a real claim about the world
- `enforcement`: action taken to bring the substrate into compliance with a rule
- `automatic_sync`: an integration mirroring a change from an external system
- `unknown`: the actor cannot or does not classify the intent

`intent_kind` is provided by the action originator. UIs that submit actions ask the user when ambiguous (or default per UI surface). Integrations default to `automatic_sync`. Agents declare based on their reasoning.

`unknown` is allowed but rare. It signals that a downstream consumer must treat the action with caution. Action handlers can be configured to refuse `unknown` for some action kinds (e.g., judgments, where intent matters).

Queries can filter by intent. "All adjustments to deal amounts in the last quarter" is one query; "all corrections" is another. AI training data pipelines can include or exclude intent classes deliberately.

## Consequences

What's now easier:
- Honest reporting. Reports can exclude noise (corrections, explorations) and focus on real changes.
- AI training data quality. Training pipelines can use intent to filter.
- Compliance. Overrides and enforcements are explicitly marked.

What's now harder:
- Every action originator decides intent. UIs must surface the choice or pick reasonable defaults per context.
- Default-picking can be wrong. A UI that always defaults to "adjustment" hides corrections. Pattern docs cover when to ask the user.

## Alternatives considered

**No intent; infer from context.** Rejected: too lossy. Inference is a heuristic that can be wrong; explicit declaration is robust.

**Smaller set (e.g., just real-vs-test).** Rejected: too coarse. The seven categories track distinctions that matter for real use cases.

**Intent as a free-text reason field.** Rejected: free text is not queryable consistently. The typed enum allows clean filters and reports. A free-text reason can be added alongside the typed intent for human-readable detail.

**Intent declared per action_kind, not per action.** Rejected: most action kinds can be performed with multiple intents. A `set_attribute` action can be a correction, adjustment, override, etc.
