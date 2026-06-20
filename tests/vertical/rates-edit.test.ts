// Beta feedback: the Rates tab should let the attorney MANAGE rates, not just
// view them. The Contract K backend (rates.ts) already supports per-client and
// per-service rates; this pins the editable client-rate round-trip the new Rates
// tab + legal.rates.* tools rely on: setClientRate is reflected in getRatesView
// (own + effective rate, no longer inheriting the firm default). DB-gated.
// (We don't mutate a live service's fee here — that would change real config.)
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { setClientRate, getRatesView } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run(
  'rates editing — client rate round-trips through getRatesView (live DB)',
  { timeout: 120_000 },
  () => {
    const tag = `rate-${Date.now()}`

    afterAll(async () => {
      await closeDbPool()
    })

    it('setClientRate is reflected in getRatesView (own + effective rate, not inheriting)', async () => {
      const created = await submitAction(ctx, {
        actionKindName: 'legal.client.create',
        intentKind: 'enforcement',
        payload: { client_name: `${tag} RateCo` },
      })
      const clientId = (created.effects[0] as { clientEntityId: string }).clientEntityId

      // Before: a brand-new client inherits the firm default.
      const before = await getRatesView(ctx)
      const beforeRow = before.clients.find((c) => c.clientEntityId === clientId)
      expect(beforeRow?.inheritsFirmDefault).toBe(true)

      await setClientRate(ctx, clientId, '425.00')

      const after = await getRatesView(ctx)
      const row = after.clients.find((c) => c.clientEntityId === clientId)
      expect(row, 'new client should appear in the rates view').toBeTruthy()
      expect(row!.ownRate).toBe('425.00')
      expect(row!.effectiveRate).toBe('425.00')
      expect(row!.inheritsFirmDefault).toBe(false)

      // The view also lists services (read-only here) — shape the Rates tab renders.
      expect(Array.isArray(after.services)).toBe(true)
    })
  },
)
