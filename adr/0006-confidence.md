# ADR 0006: Every fact has a confidence value

## Status
Accepted

## Context
Not all facts are equally reliable. A direct observation (a user typed it, an integration synced from a system of record) is high confidence. An AI inference is moderate. A speculative imputation is low. Software that treats all facts as equally certain produces overconfident outputs. AI agents trained on or operating against such data inherit that overconfidence.

Confidence is also actionable. UIs can highlight low-confidence facts. Agents can refuse to act on facts below a threshold. Resolution rules can prefer high-confidence sources when sources conflict.

## Decision
Every fact-bearing row has a `confidence` value: a number from 0.0 to 1.0.

Conventions:
- `1.0`: direct human assertion, integration sync from system of record, deterministic computation from confident inputs
- `0.7-0.99`: AI inferences with strong supporting evidence, integration sync from secondary source
- `0.4-0.69`: AI inferences with moderate evidence, statistical estimates
- `0.0-0.39`: speculative inferences, sparse-evidence imputations

Confidence is set at write time by the producer. The substrate does not invent confidence; the writer (action handler, integration adapter, agent) provides it.

Confidence flows through derivations. When a judgment combines multiple inputs, its confidence is at most the minimum of its inputs unless an explicit reasoning step justifies otherwise. The `reasoning_trace` records the calculation.

Queries can filter by confidence. UIs can visualize it. Agents include confidence in their decisions.

## Consequences

What's now easier:
- Honest output. Reports can show "we are 60% sure" instead of pretending precision.
- AI safety. Agents can be configured to refuse to write facts below a threshold or to require human approval below a threshold.
- Conflict resolution. When two sources disagree, confidence informs which to prefer.

What's now harder:
- Producers must provide confidence. Hardcoding 1.0 everywhere defeats the point. Pattern docs and code review enforce this.
- Confidence calibration. An AI agent that assigns 0.9 to everything is uncalibrated; the substrate cannot fix this, but it surfaces the problem when AI confidence is consistently wrong.

## Alternatives considered

**No confidence; rely on source type.** Rejected: source type is too coarse. Some integration syncs are more reliable than others. Some AI inferences are stronger than others.

**Discrete buckets (low, medium, high).** Rejected: harder to combine, harder to threshold. A continuous value preserves more information without much added complexity.

**Confidence interval (low, point, high) instead of a point estimate.** Considered: more honest in some contexts. Adds significant complexity to every consumer. Deferred. If the use case appears, an interval can be added as paired columns alongside the point estimate without breaking existing data.

**Confidence stored separately as a metadata table.** Rejected: makes simple queries expensive. Putting it on the row keeps the model fast and obvious.
