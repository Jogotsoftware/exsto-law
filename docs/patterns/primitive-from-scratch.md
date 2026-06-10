# Pattern: Adding a New Primitive Kind From Scratch

## When to use this pattern

When a new conceptual primitive kind needs to exist in a tenant: a new entity kind, a new attribute kind, a new relationship kind, a new judgment kind, a new workflow definition.

This is a configuration exercise, not a code change (per ADR 0023). The substrate already supports any kind that fits the existing primitive model. Adding a kind means inserting rows into definition tables.

If you are tempted to add a new TypeScript enum or hardcode a kind value somewhere, stop. You want this pattern.

## The shape

Adding a new primitive kind end-to-end requires:

1. A definition row (or rows) in the appropriate definition table
2. Optionally, MCP tool exposure if the kind has bespoke query patterns
3. Optionally, a reference app surface if you want to manipulate it via UI
4. Tests that verify the new kind works through the substrate's normal paths

## Worked example: adding a new entity kind

Let's add an entity kind for "investment thesis."

### Step 1: Insert the entity kind definition

```sql
-- supabase/migrations/00NN_add_investment_thesis_kind.sql
-- For tenant-specific kinds, this happens via the configuration interface.
-- For substrate-wide demo kinds, it can be a migration.

INSERT INTO entity_kind_definition (
  id,
  tenant_id,
  kind_name,
  display_name,
  description,
  supports_temporal_state,
  supports_judgment,
  supports_outcomes,
  requires_period
) VALUES (
  gen_random_uuid(),
  '<tenant_uuid>',
  'investment_thesis',
  'Investment Thesis',
  'A documented investment thesis tied to a sector, stage, or hypothesis.',
  true, true, false, false
);
```

### Step 2: Define the attributes for this kind

```sql
INSERT INTO attribute_kind_definition (
  id, tenant_id, kind_name, display_name, value_type, is_pii
) VALUES
  (gen_random_uuid(), '<tenant>', 'title',             'Title',             'text',     false),
  (gen_random_uuid(), '<tenant>', 'sector',            'Sector',            'text',     false),
  (gen_random_uuid(), '<tenant>', 'stage_focus',       'Stage focus',       'text',     false),
  (gen_random_uuid(), '<tenant>', 'documented_at',     'Documented at',     'datetime', false),
  (gen_random_uuid(), '<tenant>', 'authoring_partner', 'Authoring partner', 'text',     false);
```

### Step 3: Verify the kind is queryable through MCP

The existing `entity.list_by_kind` and `entity.get` tools already work for the new kind. No new code required. Verify with:

```typescript
// In a test or via the MCP server's interactive client:
await mcpClient.callTool('entity.list_by_kind', {
  entityKindName: 'investment_thesis',
  limit: 10,
});
```

### Step 4: If the kind has bespoke query patterns, add specific tools

If "find all theses authored by partner X in sector Y" is a frequent query, add a dedicated tool. If not, the generic tools suffice.

```typescript
// packages/mcp-tools/src/tools/thesisTools.ts
import { registerTool } from '../tool.js';
import { executeQuery } from '@exsto/substrate';

registerTool({
  name: 'thesis.search',
  description: 'Search investment theses with optional filters by partner, sector, or date.',
  mode: 'read',
  handler: async (ctx, input: { partner?: string; sector?: string; documentedAfter?: string }) => {
    const { rows } = await executeQuery(ctx, /* SQL filtering investment_thesis by attribute values */ ``, []);
    return { theses: rows };
  },
});
```

### Step 5: If a UI surface is wanted, add it to the reference app

Following the `reference-app-surface.md` pattern.

### Step 6: Add tests

```typescript
// tests/primitives/investment_thesis.test.ts

describe('investment_thesis entity kind', () => {
  it('inherits all 23 invariants', async () => {
    // Run the standard invariant test suite against the new kind
    await runInvariantSuite('investment_thesis');
  });

  it('accepts the documented attributes', async () => {
    // ...
  });

  it('rejects undocumented attributes', async () => {
    // attribute_kind_definition does not include "founder_age"
    await expect(setAttribute(ctx, {
      entityId: thesisId,
      attributeKindName: 'founder_age',
      // ...
    })).rejects.toThrow(/no attribute definition/);
  });
});
```

## What you do not have to do

- Add a TypeScript enum value
- Add a Postgres enum value
- Modify `entity` table columns
- Modify the action layer
- Modify the MCP server
- Modify the worker runtime

If the new kind requires any of those changes, that's a sign the substrate is missing a primitive concept (which is a Layer 1 question, not a configuration one).

## Customization points

The same pattern adapts for:

- New attribute kinds: insert into `attribute_kind_definition`
- New relationship kinds: insert into `relationship_kind_definition`
- New event kinds: insert into `event_kind_definition`
- New judgment kinds: insert into `judgment_kind_definition` with the value scale
- New action kinds: insert into `action_kind_definition` with autonomy default and reversibility profile
- New workflow definitions: insert into `workflow_definition` with the state machine
- New rubrics: insert into `rubric_definition` with criteria
- New permission scopes: insert into `permission_scope_definition`

Each follows the same shape: insert the definition row, verify it works through existing primitives and tools, add bespoke tools or surfaces only if needed.

## Common mistakes

**Adding a TypeScript enum.** Hardcoding "investment_thesis" in code creates a parallel definition that diverges from the data. Don't.

**Skipping `attribute_kind_definition`.** Inserting an entity_kind without defining its attributes means writes succeed but produce data that doesn't match the kind's schema. Always define attributes.

**Skipping the version.** New definitions get version IDs from creation. Edits to the definition create new versions; in-flight operations remain bound to the old version (ADR 0017).

**Per-customer code branches.** "We need a custom kind for IFP" is a definition row insertion in IFP's tenant. Not a code change. Not a fork.

## Related ADRs and patterns

- ADR 0012: Schema-as-data
- ADR 0017: Configuration version binding
- ADR 0023: Extensibility via configuration data
- Pattern: `mcp-tool.md` (for bespoke tools)
- Pattern: `reference-app-surface.md` (for UI surfaces)
