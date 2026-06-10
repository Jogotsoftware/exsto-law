# ADR 0040: Canonical registry naming is `<concept>_kind_definition`

## Status
Accepted. Resolves QUESTIONS.md #11.

## Context
Schema-as-data (invariant 12) means the substrate's vocabulary lives in registry tables. The built schema names every one of them `<concept>_kind_definition`:

`entity_kind_definition`, `attribute_kind_definition`, `relationship_kind_definition`, `event_kind_definition`, `judgment_kind_definition`, `outcome_kind_definition`, `period_kind_definition`, `action_kind_definition`.

ARCHITECTURE.md's Layer 2 prose, however, refers in places to **`attribute_definition`** (and `attribute_definition` is the DoD shorthand). That is the only registry the prose names without the `_kind_` infix, which raised the question: rename the table to `attribute_definition` to match the prose, or keep `attribute_kind_definition` to match its seven siblings?

## Decision
**Keep `attribute_kind_definition`.** The `<concept>_kind_definition` pattern is the canonical naming convention for every kind/definition registry in the substrate, and every clone and vertical inherits it. The prose's `attribute_definition` is read as shorthand for the `attribute_kind_definition` table, not as a competing name.

Rationale:
- **Consistency beats the shorthand.** One predictable rule (`<concept>_kind_definition`) across eight registries is more valuable to every reader, tool, and generated artifact than matching one descriptive sentence.
- **It is already canonical in the built system.** The tables, the seed, the primitive code, the MCP tools, the skills, and the live `exsto-dev` schema all use `attribute_kind_definition`. Renaming would churn migrations, code, skills, and the live DB for a purely cosmetic change — against the foundation's "names are precise and stable" discipline.
- **ARCHITECTURE.md is not contradicted.** Its prose describes the *concept* ("the schema for an attribute kind"); the table name is an implementation detail the prose summarizes. No invariant changes. This is a v2.0.x-level clarification, not an architecture change.

New registries (for new primitives or verticals) MUST follow the same pattern: `<concept>_kind_definition`.

## Consequences
- No schema change; no migration. Purely a documented convention.
- When ARCHITECTURE.md is next revised at patch level, the `attribute_definition` mentions may be annotated as `attribute_kind_definition`; until then this ADR is the reconciliation of record.
- The `exsto-add-kind` skill and any registry-generating tooling name new registries `<concept>_kind_definition`.

## Pointers
- The eight registries above (migrations 0002 / 0006 / 0009 / 0012).
- ARCHITECTURE.md Layer 2 (attribute / attribute definition); QUESTIONS.md #11.
