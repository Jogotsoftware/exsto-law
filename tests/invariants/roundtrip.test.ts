// End-to-end engine round-trip against a live substrate DB. Exercises the action
// layer and several invariants in normal operation: schema-as-data (12), the
// action write path (9), temporality + supersession (2), provenance/knowability
// (5/7). DB-gated: needs SUBSTRATE_TEST_DATABASE_URL (or DATABASE_URL) pointing
// at a seeded substrate (the Exsto Dev tenant). Skipped otherwise.
import { describe, it, expect, afterAll } from 'vitest'
import type { ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'
import {
  createEntity,
  setAttribute,
  getEntity,
  getCurrentAttributes,
  getAttributeHistory,
  getCapabilities,
} from '@exsto/primitives'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

run('substrate engine round-trip (live DB)', () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('invariant 12: capabilities are read from the definition registries', async () => {
    const caps = await getCapabilities(ctx)
    expect(caps.entityKinds.map((k) => k.kind_name)).toContain('person')
    expect(caps.actionKinds.map((k) => k.kind_name)).toContain('entity.create')
  })

  it('invariants 9/5/7: create an entity with a provenanced attribute via the action layer', async () => {
    const result = await createEntity(ctx, {
      entityKindName: 'person',
      intentKind: 'exploration',
      attributes: [
        {
          attributeKindName: 'full_name',
          value: 'Round Trip',
          confidence: 1,
          knowabilityState: 'observed',
          timePrecision: 'exact_instant',
        },
      ],
    })
    const effect = result.effects[0] as { entityId: string }
    expect(effect.entityId).toBeTruthy()
    const entity = await getEntity(ctx, effect.entityId)
    expect(entity?.entity_kind_name).toBe('person')
    expect(entity?.name).toBe('person')
  })

  it('invariant 2: setAttribute supersedes the prior open value', async () => {
    const created = await createEntity(ctx, {
      entityKindName: 'deal',
      intentKind: 'exploration',
      attributes: [],
    })
    const entityId = (created.effects[0] as { entityId: string }).entityId

    await setAttribute(ctx, {
      entityId,
      attributeKindName: 'status',
      value: 'open',
      confidence: 1,
      knowabilityState: 'observed',
      timePrecision: 'day',
      intentKind: 'adjustment',
    })
    await setAttribute(ctx, {
      entityId,
      attributeKindName: 'status',
      value: 'won',
      confidence: 1,
      knowabilityState: 'observed',
      timePrecision: 'day',
      intentKind: 'adjustment',
    })

    const current = await getCurrentAttributes(ctx, entityId)
    const statusNow = current.filter((a) => a.attribute_kind_name === 'status')
    expect(statusNow).toHaveLength(1)
    expect(statusNow[0]!.value).toBe('won')

    const history = await getAttributeHistory(ctx, entityId, 'status')
    expect(history).toHaveLength(2) // both observations retained (append-only)
  })
})
