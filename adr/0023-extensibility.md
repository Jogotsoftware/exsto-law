# ADR 0023: Extensibility happens through configuration, not code

## Status
Accepted

## Context
The substrate must support many tenants in different verticals. VC firms model deals and portfolio companies. Recruiting firms model candidates and roles. M&A teams model targets and pipelines. The substrate cannot fork its codebase per vertical.

Schema-as-data (ADR 0012) gives us the mechanism: kinds, attributes, workflows, rubrics, permission scopes are all data. Extensibility is the discipline of using that mechanism. New entity kinds are added by inserting rows. New workflows are added by inserting rows. Customer-specific configurations live in their tenants' definition tables, not in branches of the codebase.

Code changes are reserved for: substrate engine bugs, performance improvements, new primitive kinds (rare and Layer 1), new MCP tool capabilities (Layer 2), Layer 4 features.

## Decision
Tenant-specific configuration lives in definition tables, not code.

Specifically:
- New entity kinds for a tenant: rows in `entity_kind_definition`.
- New attribute kinds: rows in `attribute_definition`.
- New relationship kinds: rows in `relationship_kind_definition`.
- New workflow types: rows in `workflow_definition`.
- New rubrics: rows in `rubric_definition`.
- New permission scopes: rows in `permission_scope_definition`.
- New trigger conditions: rows in `trigger_definition`.

Code changes for vertical-specific concepts are forbidden. If a request comes in to "add a `pipeline_stage` enum value for IFP," the answer is to add it as a definition row, not a code change.

Substrate code changes happen for:
- Bug fixes in the substrate engine
- Performance improvements
- New primitive kinds (changes Layer 1; rare)
- New runtime engines (e.g., a new evaluator type)
- New MCP tools (capabilities, not specific data)
- Layer 4 features

The boundary is clear: if it's "this customer needs X for their use case," it's configuration. If it's "the substrate needs Y to support a class of use cases," it's code.

## Consequences

What's now easier:
- Multi-vertical scaling. Tenants in different verticals coexist without code branching.
- Customer onboarding. Adding a new customer is a configuration exercise, not an engineering one.
- The configuration agent (Layer 4) is possible. An AI can add definition rows; it cannot deploy code.

What's now harder:
- Tempting to add a "quick code change" for a customer requirement. Discipline says no, even when configuration is harder. The pattern "would this same change apply to any other tenant or vertical" is the test.
- Configuration tooling must be good. Bad configuration UX makes the discipline hard to maintain.
- Some genuine substrate improvements look like configuration ones. Distinguishing them requires judgment. ADRs document the distinction case by case.

## Alternatives considered

**Hybrid: some kinds in code, some in data.** Rejected: produces two systems with different rules. The discipline is purer if everything tenant-facing is data.

**Plugins as code, customer-specific.** Rejected: customer-specific code paths are tech debt. The substrate avoids them.

**Configuration as JSONB blobs.** Rejected: defeats queryability. Typed definition tables allow joins and indexes.

**Code-generation from configuration.** Considered as a developer experience improvement. Per-tenant types could be generated from definition rows. Useful but not required for the substrate to work.
