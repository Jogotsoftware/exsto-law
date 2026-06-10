---
name: exsto-add-kind
description: Add a new domain concept to an Exsto tenant as a definition ROW, never a new table or enum (schema-as-data). ALWAYS consult this when you want a new entity/attribute/relationship/event/judgment/outcome/action/workflow/role kind, or when tempted to add a TypeScript enum, a switch on a "type", a new table, or an ALTER TABLE for a business concept.
---

# Adding a kind (schema-as-data)

A new concept in Exsto is a *row in a definition registry* — not a new table, column, enum, or class. The substrate already supports any concept that fits the primitive model; "adding" one means inserting a definition row scoped to a tenant. This is what lets one engine serve every vertical and lets configuration version independently of code (ADR 0012, 0023). The moment a kind name is hardcoded in TypeScript, the data and the code diverge and the guarantee breaks.

## The rule

If you catch yourself writing `enum EntityKind {...}`, `CREATE TABLE deal (...)`, `switch (kind) { case 'invoice': }`, or `ALTER TABLE entity ADD COLUMN` for a business concept — stop. The concept is data. Insert into the matching registry:

| Concept | Registry table | Define via |
| --- | --- | --- |
| entity kind | `entity_kind_definition` | `substrate.kind.define` / seed row |
| attribute kind | `attribute_kind_definition` | `substrate.kind.define` |
| relationship kind | `relationship_kind_definition` | `substrate.kind.define` |
| event / judgment / outcome kind | `event_kind_definition` etc. | `substrate.kind.define` |
| action kind | `action_kind_definition` | seed / migration (carries autonomy + reversibility) |
| workflow / role / period / permission scope | `workflow_definition`, `role_definition`, ... | `substrate.action.submit` with the matching action kind |

## Two ways to add a kind

1. **At runtime (preferred for tenant concepts):** call the MCP tool `substrate.kind.define` (`{ registry, kind_name, display_name, description?, extra? }`). It routes through the `kind.define` action, so the change is itself an audited action — no deploy.
2. **As substrate-wide seed (only for kinds every tenant should start with):** add a row to `supabase/seed/0001_initial_data.sql` with a fixed UUID + `ON CONFLICT DO NOTHING`, scoped to the tenant. Copy the existing block exactly.

Either way it is a definition *row*. No code change to the engine, MCP server, or worker is needed for the kind to be queryable — the generic tools (`entity.create`, `entity.list_by_kind`, `attribute.set`, `entity.context`, ...) already work for it.

## Required fields that are easy to miss

- **Entity kinds** carry capability flags `supports_temporal_state`, `supports_judgment`, `supports_outcomes`, `requires_period` — match them to the concept (see the seed `person` / `deal` rows).
- **Attribute kinds** carry `value_type` and `is_pii` — set `is_pii = true` for anything personal.
- **Action kinds** carry `default_autonomy_tier` (autonomous/notify/approve/suggest), `reversibility`, and `requires_reasoning_trace` — these gate governance; choose deliberately.
- **Relationship kinds** carry `cardinality`, `directionality`, `inverse_kind_name`.
- **Definitions are versioned** (`valid_from`/`valid_to`, `status`): editing a kind = a new version; in-flight operations stay bound to the old version (ADR 0017). Never mutate a sealed definition row.

## Gotchas

- **Kinds are tenant-scoped.** Every definition row has a `tenant_id`. A kind defined for tenant A does not exist for tenant B. A new tenant needs its own kind rows (see exsto-bootstrap-tenant).
- **Define attributes, not just the entity kind.** An entity kind with no `attribute_kind_definition` rows accepts no schema'd attributes. Add both.
- **Per-customer "custom kind" is a row, not a fork.** Never branch code per customer; insert a definition row in that tenant.

## Pointers to ground truth

- `docs/patterns/primitive-from-scratch.md` — the full worked example.
- `supabase/seed/0001_initial_data.sql` — canonical seed-row shapes for every registry.
- `packages/mcp-tools/src/tools/substrateTools.ts` — `substrate.kind.define`.
- ADRs 0012 (schema-as-data), 0017 (version binding), 0023 (extensibility).

## Verify

After defining a kind it must appear in capabilities and be usable with zero code changes:

```
substrate.capability.list               -> the new kind_name is listed
entity.create   { entityKindName }      -> succeeds (entity kinds)
entity.list_by_kind { entityKindName }  -> returns it
```

And confirm nothing was hardcoded: `git grep -i '<kind_name>' packages/` returns only data/migration files — never an enum or switch in engine code.
