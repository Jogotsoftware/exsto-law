// Service cost (beta sprint Obj 10). setServiceCost writes hourly (rate + hours)
// or fixed (flat fee) pricing into transitions.cost as decimal strings (ADR 0044),
// and every ServiceDefinition read carries it back. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { createService, setServiceCost, getService } from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Service cost (live DB)', { timeout: 120_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('sets hourly/fixed cost as decimal strings and clears it', async () => {
    const created = await createService(ctx, {
      displayName: `Cost Test ${Date.now()}`,
      description: null,
      route: 'manual',
    })
    const key = created.serviceKey
    expect(created.cost).toBeNull()

    // Hourly: rate + estimated hours.
    const hourly = await setServiceCost(ctx, {
      serviceKey: key,
      cost: { type: 'hourly', amount: '350.00', hours: 8 },
    })
    expect(hourly.cost).toEqual({ type: 'hourly', amount: '350.00', hours: 8 })

    // Fixed: flat fee, hours dropped.
    const fixed = await setServiceCost(ctx, {
      serviceKey: key,
      cost: { type: 'fixed', amount: '5000.00', hours: 99 },
    })
    expect(fixed.cost).toEqual({ type: 'fixed', amount: '5000.00', hours: null })

    // Persisted across an independent read.
    const reread = await getService(ctx, key)
    expect(reread?.cost).toEqual({ type: 'fixed', amount: '5000.00', hours: null })

    // Invalid money is rejected.
    await expect(
      setServiceCost(ctx, {
        serviceKey: key,
        cost: { type: 'fixed', amount: '5,000', hours: null },
      }),
    ).rejects.toThrow()

    // Clearing.
    const cleared = await setServiceCost(ctx, { serviceKey: key, cost: null })
    expect(cleared.cost).toBeNull()
  })
})
