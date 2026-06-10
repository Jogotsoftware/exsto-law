# The 7 primitives and their runtime engines

This package implements the 7 core primitives, their definition registries, and the runtime engines that read those registries.

## What lives here

- Entity, attribute, relationship, event, judgment, outcome, action implementations
- Definition registries (entity_kind_definition, attribute_definition, etc.)
- Workflow execution engine (reads workflow_definition rows, runs state machines)
- Trigger evaluation engine (reads trigger_definition rows, evaluates conditions)
- Rubric evaluation engine (reads rubric definitions, evaluates against entities)
- Permission scope evaluation engine (reads permission_scope_definition rows, evaluates authorization)
- Identity assertion handling

## Schema-as-data discipline

New entity kinds, attribute kinds, relationship kinds, workflow definitions, permission scopes are added by inserting rows into definition tables. Never by writing a hardcoded enum, switch statement, or class.

If the temptation arises to hardcode a kind in this package, that is a signal to add a definition row instead.

## Hard rules in this package

1. Every primitive operation goes through the action layer in packages/substrate. No direct INSERT/UPDATE/DELETE on substrate tables.
2. Runtime engines (workflow, trigger, rubric, permission) read definitions at evaluation time and bind to definition versions per invariant 17.
3. Engines are deterministic. Given the same inputs and the same definition version, they produce the same output.
