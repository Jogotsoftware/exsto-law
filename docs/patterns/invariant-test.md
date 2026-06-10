# Pattern: Invariant Test

## When to use this pattern

Anytime you need to prove that a Layer 1 invariant holds (or fails to hold) for a piece of substrate code.

The test suite in `tests/invariants/` has one suite per invariant. Each suite verifies that the invariant cannot be violated by ordinary code paths. New primitives, new MCP tools, and new worker handlers each get tested for invariant compliance.

## What an invariant test proves

Invariant tests are negative: they try to do something that would violate the invariant and expect to fail.

For example, the tenancy invariant test tries to read tenant B's data while authenticated as tenant A. The test passes if the read returns nothing or errors. It fails (red, broken substrate) if the read returns tenant B's data.

## Working example: tenancy isolation

```typescript
// tests/invariants/0001-tenancy.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTenant,
  createActor,
  createActionContext,
  setAttribute,
  fetchEntity,
  type ActionContext,
} from '@exsto/substrate';

describe('Invariant 1: Tenancy isolation', () => {
  let tenantA: string;
  let tenantB: string;
  let ctxA: ActionContext;
  let ctxB: ActionContext;
  let entityInA: string;

  beforeEach(async () => {
    tenantA = await createTenant({ name: 'tenant-a' });
    tenantB = await createTenant({ name: 'tenant-b' });

    const actorA = await createActor({ tenant_id: tenantA, type: 'human' });
    const actorB = await createActor({ tenant_id: tenantB, type: 'human' });

    ctxA = await createActionContext({ tenant_id: tenantA, actor: actorA });
    ctxB = await createActionContext({ tenant_id: tenantB, actor: actorB });

    // Tenant A creates an entity
    entityInA = await createEntity(ctxA, {
      entity_kind_id: '<some_kind>',
      attributes: [{ name: 'title', value: 'Tenant A secret data' }],
    });
  });

  it('refuses cross-tenant reads', async () => {
    // Attempt to read tenant A's entity from tenant B's context
    const result = await fetchEntity(ctxB, entityInA);
    expect(result).toBeNull();  // RLS hides the row
  });

  it('refuses cross-tenant writes', async () => {
    // Attempt to update tenant A's entity from tenant B's context
    await expect(setAttribute(ctxB, {
      entity_id: entityInA,
      attribute_kind_id: '<title_attr>',
      value: 'Tampered by tenant B',
      // ... other required fields
    })).rejects.toThrow(/no rows updated|tenancy violation/i);
  });

  it('refuses queries without tenant context', async () => {
    const ctxNoTenant = await createActionContext({ tenant_id: null, actor: null });
    await expect(fetchEntity(ctxNoTenant, entityInA))
      .rejects.toThrow(/tenant context required/i);
  });

  it('isolates concurrent contexts', async () => {
    // Create the same name in both tenants. Should not collide.
    const entityB = await createEntity(ctxB, {
      entity_kind_id: '<some_kind>',
      attributes: [{ name: 'title', value: 'Same title in tenant B' }],
    });

    const fromA = await fetchEntity(ctxA, entityInA);
    const fromB = await fetchEntity(ctxB, entityB);

    expect(fromA?.id).not.toEqual(fromB?.id);
    expect(fromA?.tenant_id).toEqual(tenantA);
    expect(fromB?.tenant_id).toEqual(tenantB);
  });
});
```

## What every invariant test should cover

For any invariant, the test suite should verify:

1. **The intended path works.** The invariant doesn't break ordinary operation.
2. **The violation path fails.** Code that would violate the invariant errors clearly.
3. **The violation path fails consistently.** Try the violation in multiple ways: through the action layer, through MCP tools, through worker handlers. Any path should be caught.
4. **The error message identifies the invariant.** When something fails because of an invariant, the error message names which invariant was violated. This is key for debuggability.

## Working example: append-only events

```typescript
// tests/invariants/0014-append-only-events.test.ts

describe('Invariant 14: Append-only event tables', () => {
  it('refuses UPDATE on event table', async () => {
    const eventId = await createEvent(ctx, { /* ... */ });
    await expect(
      db.query('UPDATE event SET payload = $1 WHERE id = $2', [{ tampered: true }, eventId])
    ).rejects.toThrow(/permission denied|policy violation/i);
  });

  it('refuses DELETE on event table', async () => {
    const eventId = await createEvent(ctx, { /* ... */ });
    await expect(
      db.query('DELETE FROM event WHERE id = $1', [eventId])
    ).rejects.toThrow(/permission denied|policy violation/i);
  });

  it('records corrections as new rows', async () => {
    const original = await createEvent(ctx, { payload: { original: true } });
    const correction = await createCorrection(ctx, {
      corrects_id: original,
      payload: { corrected: true },
    });

    // Both rows exist
    const both = await fetchEvents(ctx, { ids: [original, correction] });
    expect(both).toHaveLength(2);

    // The correction references the original
    expect(both.find(e => e.id === correction)?.corrects_id).toEqual(original);
  });
});
```

## Customization points

When writing a new invariant test or extending an existing suite:

1. **Identify the invariant precisely.** What property must hold?
2. **Identify the violations.** Enumerate ways the invariant could fail.
3. **Test both directions.** Successful normal operation; failed violation attempts.
4. **Test through every path.** Substrate functions, MCP tools, workers, direct database (where applicable).
5. **Verify error clarity.** When the violation is caught, the error names the invariant.

## Common mistakes

**Testing only the happy path.** "It works when used correctly" doesn't prove the invariant. Test the misuse cases.

**Mocking the database.** Invariant tests must run against a real Postgres with RLS enabled. Mocks bypass the very mechanisms being tested.

**Testing one path only.** A tenancy test that only goes through MCP tools doesn't catch a substrate function that bypasses tenancy. Test all paths.

**Skipping cleanup.** Each test creates rows. Tests must clean up or use transactional rollback. Otherwise the suite leaks state.

**Vague error matching.** `expect(...).toThrow()` without a pattern catches any error, including bugs in the test setup. Match the expected error specifically.

## Related ADRs and patterns

- All ADRs 0001-0023 (one per invariant being tested)
- Pattern: `action-handler.md` (action handlers are tested against invariants)
