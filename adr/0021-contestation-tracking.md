# ADR 0021: Contestation is a first-class observation

## Status
Accepted

## Context
When two facts disagree, software typically picks one and silently discards the other. The choice is made by some priority rule (most recent, highest authority, manual override) and the discarded fact disappears.

This is wrong for a system of record. The disagreement itself is information. Two sources reporting different values for the same thing tells you something about the sources. A user disputing an AI's judgment tells you something about the AI's calibration. Throwing the disagreement away erases signal that matters.

For AI agents, contestation also matters as a training input. Cases where an agent's claim was contested are exactly the cases where the agent's calibration is in question. Without contestation tracking, this signal is invisible.

## Decision
Every contestation is recorded as a `fact_contestation` row: `(contested_id, contestant, basis, alternative_value, recorded_at, status, resolution_id)`.

Contestations have provenance, confidence, and validity. They can themselves be contested.

When a contestation is recorded, the substrate does not silently pick a winner. The contestation status starts as `open`. Resolution is an explicit action: an authorized actor (or a configured rule) resolves the contestation, recording the resolution as an action with its own provenance and reasoning.

Resolution kinds:
- `accept_alternative`: the contestation wins; the original fact is marked superseded
- `reject_alternative`: the contestation loses; the original fact stands
- `accept_both`: the contestants are reframed as separate facts with different scopes
- `escalate`: resolution is deferred to a higher authority

Until resolution, queries return both the original fact and the contestation, with metadata indicating the conflict. Consumers (UIs, agents) can choose how to display.

Contestations feed the AI feedback loop. When an AI claim is contested, the contestation is a signal about that AI's calibration, queryable in aggregate.

## Consequences

What's now easier:
- Honest reporting. Disagreements are visible, not hidden.
- AI calibration. Contestation rates per agent are measurable.
- Debugging. "Why does the system say X?" can be answered with "Because Y was contested and resolved this way."

What's now harder:
- UIs must handle contested values gracefully. Displaying both with a marker is the default; pattern docs cover the variants.
- Resolution rules need authoring. A tenant must decide who can resolve contestations and how.
- Queries that just want "the current truth" must specify whether they include contested values. Default helpers respect resolution status.

## Alternatives considered

**Last-write-wins.** Standard. Rejected: erases information.

**Source-priority rules (production source wins over inferred).** Useful but insufficient. Even within a single source category, contestations happen.

**Contestation only for AI-generated facts.** Rejected: contestation is general. Two integration sources can disagree; two humans can disagree; AI and human can disagree. The model is uniform.

**Contestation as just another judgment.** Rejected: judgments evaluate something; contestations dispute a specific fact. Different shape, different queries.
