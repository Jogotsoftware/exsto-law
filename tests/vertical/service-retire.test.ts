// Retire a service (beta sprint Obj 12). legal.service.retire seals the current
// service row with no successor, so it leaves every listing while its history is
// preserved (the row stays, valid_to set). DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { createService, retireService, listServicesIncludingInactive } from '@exsto/legal'
import { withSuperuser, closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Retire service (live DB)', { timeout: 120_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('removes a service from listings but keeps its history', async () => {
    const created = await createService(attorneyCtx, {
      displayName: `Retire Test ${Date.now()}`,
      description: null,
      route: 'manual',
    })
    const key = created.serviceKey

    // It exists (as a draft/disabled row) before retirement.
    const before = await listServicesIncludingInactive(attorneyCtx)
    expect(before.some((s) => s.serviceKey === key)).toBe(true)

    const res = await retireService(attorneyCtx, key)
    expect(res.retired).toBe(true)

    // Gone from every listing…
    const after = await listServicesIncludingInactive(attorneyCtx)
    expect(after.some((s) => s.serviceKey === key)).toBe(false)

    // …but the row is sealed (valid_to set), not deleted — history preserved.
    const sealed = await withSuperuser(async (client) => {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM workflow_definition
         WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NOT NULL`,
        [TENANT, key],
      )
      return Number(r.rows[0]!.n)
    })
    expect(sealed).toBeGreaterThan(0)

    // Retiring an already-retired service is rejected (no current row).
    await expect(retireService(attorneyCtx, key)).rejects.toThrow()
  })
})
