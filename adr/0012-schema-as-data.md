# ADR 0012: Schema is data, not code

## Status
Accepted

## Context
Most software encodes its schema in code: enum types in TypeScript, classes in object models, hardcoded validators. Adding a new entity kind, a new field, a new workflow stage requires a code change, a deploy, and often a database migration.

For Exsto, this model breaks against multiple use cases. Customers want to add custom fields without engineering involvement. Verticals (VC firms, M&A teams, recruiting firms) need different entity kinds without forking the codebase. The eventual configuration agent (Layer 4) must be able to add kinds, attributes, workflows, and rubrics in response to user requests, without code deploys.

Code-as-schema also produces tech debt at scale. Every customer-specific enum value lives in the codebase forever. Every removed value requires a migration plus careful code review. The substrate must be configurable without becoming a graveyard of customer-specific code.

## Decision
The schema is data. Definition tables hold the configuration that other primitives obey:

- `entity_kind_definition`: what kinds of entities exist for a tenant
- `attribute_definition`: what attributes apply to which entity kinds
- `relationship_kind_definition`: what kinds of relationships exist
- `event_kind_definition`: what kinds of events can be recorded
- `judgment_definition`: what judgments can be made, with what scales
- `outcome_definition`: what outcomes can be recorded
- `action_kind_definition`: what action kinds exist with what reversibility profiles
- `workflow_definition`: what workflows exist with what state machines
- `trigger_definition`: what triggers exist with what conditions
- `permission_scope_definition`: what authorization rules apply
- `rubric_definition`: what evaluation rubrics exist

Adding a new entity kind for a tenant is an INSERT into `entity_kind_definition`. The substrate, MCP tools, and reference app discover new kinds at runtime by querying these tables.

Definitions are versioned. A definition row references a `definition_version_id`. In-flight operations bind to the version that was current at their start (see ADR 0017). Editing a definition creates a new version; the old version remains queryable.

Hardcoded enums in code that mirror data in definition tables are forbidden. If Postgres enums or TypeScript union types appear, they must come from the data, not code.

## Consequences

What's now easier:
- Adding kinds without code changes. The configuration agent (Layer 4) becomes possible.
- Multi-vertical support. VC firms and recruiting firms have different entity kinds; both run on the same code.
- Custom fields. A customer-specific attribute is a row, not a fork.

What's now harder:
- Type safety. TypeScript cannot statically check kinds that are data. Runtime validation against definition tables takes the place of compile-time checks. Code generation from definitions can recover some static safety per tenant.
- Definition table integrity. Definitions can become inconsistent (an attribute pointing at a deleted entity kind). Foreign keys and validation prevent the worst cases; soft inconsistency requires linters and tests.
- Migration of definition versions. When a definition changes, in-flight operations must continue against the old version. Bookkeeping required (ADR 0017).

## Alternatives considered

**Hardcoded schema with override extensibility.** Some kinds in code, others in data. Rejected: produces two systems with different rules. The discipline is purer if everything is data.

**Schema-as-data only at the application layer; database has fixed tables.** This is partially what we do (entities live in one `entity` table; their kinds are defined in `entity_kind_definition`). Pure schema-as-data would mean dynamic table creation, which Postgres supports poorly. Our compromise: a small fixed set of substrate tables, with definitions as data on top.

**Code generation from definitions.** Tooling could generate TypeScript types per tenant from their definition rows. Considered, deferred. Useful as a developer experience improvement; not required for the substrate to work.

**JSONB columns instead of typed columns.** Rejected for the substrate level: JSONB makes queries inefficient at scale. We use JSONB only for genuinely arbitrary data (e.g., raw event payloads).
