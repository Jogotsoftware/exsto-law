# ADR 0017: In-flight operations bind to configuration versions at start

## Status
Accepted

## Context
Schema-as-data (ADR 0012) means definitions can change while operations are running. A workflow defined a year ago may have a new version today. A long-running ingestion job started yesterday may finish after a definition change.

If operations bind to current configuration on every read, definition changes mid-flight produce surprising behavior. A workflow instance that was started under old rules and finishes under new rules has been doing inconsistent things along the way. An ingestion that started with one entity kind definition and ends with another may have inserted half its rows under one schema and half under another.

## Decision
Every operation binds to configuration versions at start.

Implementation: every definition table has a `version_id` per row. New definition versions get new IDs. Operations that depend on definitions record which version they bound to:

- Workflow instances bind to a `workflow_definition_version_id` at instantiation.
- Trigger evaluations bind to a `trigger_definition_version_id` at trigger time.
- Permission checks bind to the `permission_scope_definition_version_id` current at the start of the request.
- Projections bind to the definition versions current when the events being projected were originally processed.

When an operation runs, it reads the bound version, not the latest. Configuration changes after the operation started do not affect the operation's behavior.

A separate mechanism handles "upgrade in place" for cases that need it: an explicit migration that re-binds an in-flight operation to a new version, with the migration recorded as an action.

## Consequences

What's now easier:
- Definition changes are safe. In-flight work continues under known rules.
- Audit. Every operation has a recorded version binding, so reconstruction knows which rules applied.
- Determinism. Re-running a workflow against the same definition version produces the same result.

What's now harder:
- Definition versions accumulate. The substrate keeps every version that any in-flight operation might bind to. Cleanup is possible only when no in-flight operations remain on old versions.
- The action layer records version bindings. Adds bookkeeping per action.
- Re-projections must use historical versions, not current. Projection workers query the version table for the version current at the original event's recorded_at.

## Alternatives considered

**Latest-version always.** Rejected: changes to definitions break in-flight operations unpredictably.

**Snapshot the entire definition table at operation start.** Rejected: expensive in storage, expensive in lookup.

**Versioning per-operation manually (each handler decides what to do).** Rejected: relies on handler discipline. The substrate makes version binding automatic.

**Forbid definition changes while operations are in flight.** Rejected: operationally infeasible. Always-something-running means changes never happen.
