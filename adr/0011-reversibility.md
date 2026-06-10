# ADR 0011: Reversibility is declared per action kind

## Status
Accepted

## Context
"Undo" in software is often informal: maintained as a feature in a specific UI, not as a property of the data model. The substrate, as a system of record with AI agents acting against it, needs reversibility to be a substrate-level concern, not a UI feature.

Some actions are naturally reversible. Setting an attribute can be undone by setting it back. Some are reversibly with caveats: deleting an entity can be undone if no dependent state has accumulated since. Some are practically irreversible: sending an external email cannot be unsent, even if the substrate's record of "we sent it" can be marked rescinded.

For AI agents, reversibility shapes safety. An agent that knows an action is fully reversible can take it more freely. An agent facing an irreversible action requires more oversight.

## Decision
Every `action_kind_definition` declares a reversibility profile. The profile is structured:

- `reversibility`: one of `fully_reversible`, `reversible_with_state_decay`, `reversible_with_external_caveats`, `irreversible`
- `reverse_action_kind`: the action kind that undoes this one (NULL if irreversible)
- `time_window`: how long after the original action the reversal remains valid (NULL for indefinite)
- `compensation_strategy`: structured description of what the reversal does (e.g., "restore prior attribute value," "delete the inserted row," "send a corrective notification to external system")

When an action is taken, the substrate records its reversibility profile alongside the action. A reversal is itself an action of the declared `reverse_action_kind`, with a `reverses_action_id` link to the original.

For irreversible actions, agents and humans can be configured to require explicit confirmation. The action layer evaluates reversibility against autonomy tier; an autonomous agent attempting an irreversible action can be blocked structurally.

Reversal does not delete the original action. Both the original and the reversal exist in the action log. This preserves history.

## Consequences

What's now easier:
- AI safety. Irreversible actions can require human approval based on declared profiles.
- Undo as a substrate primitive. UIs can offer undo against actions whose profiles allow it.
- Audit. The reversal chain shows what was done and what was undone.

What's now harder:
- Every action kind requires a reversibility analysis at definition time. The default is `irreversible` (safe), but most kinds can be classified more precisely.
- Compensation strategies for `reversible_with_state_decay` need to be tested. A reversal that worked on a fresh deletion may fail if dependent state has accumulated.
- External-system reversals require integration support. The substrate cannot unsend an email; it can only record the rescission and notify the external system.

## Alternatives considered

**No reversibility model; UIs implement undo per surface.** Rejected: misses the AI safety use case entirely. An agent has no way to know whether its action is reversible.

**Universal reversibility (every action is undoable).** Rejected: not true for external-side-effecting actions. Pretending it's true misleads agents and humans.

**Reversibility computed at runtime instead of declared.** Considered. Some reversibility is context-dependent (a deletion is reversible if no dependent state accumulated). The declared profile is the maximum reversibility; runtime checks confirm whether the specific case still qualifies.

**Soft delete instead of explicit reversibility.** Rejected: works for some kinds (entities) but not others (judgments, actions, communications). The reversibility model is uniform across action kinds.
