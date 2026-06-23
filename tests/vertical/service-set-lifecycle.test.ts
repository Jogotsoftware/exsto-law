// legal.service.set_lifecycle (ADR 0045, PR4a). Authoring a workflow graph onto a
// service writes a NEW immutable version with the graph in states, carrying the
// service's transitions forward, recording a configuration_change, bumping version,
// and keeping status. An invalid graph (validateLifecycle fails) is rejected.
// DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  createService,
  setServiceLifecycle,
  getServiceLifecycle,
  NC_SMLLC_AUTHORED,
} from '@exsto/legal'
import type { Lifecycle } from '@exsto/legal'
import { withSuperuser, closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

// Two entry stages — fails validateLifecycle's "exactly one entry stage" rule.
const INVALID_TWO_ENTRY: Lifecycle = [
  { key: 'a', label: 'A', entry: true, advances_to: [{ to: 'b', gate: 'attorney' }] },
  { key: 'b', label: 'B', entry: true, terminal: true, advances_to: [] },
]

run('Author service lifecycle (live DB)', { timeout: 120_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('writes the graph into states, carries transitions forward, bumps version, keeps status, records a config change', async () => {
    const created = await createService(attorneyCtx, {
      displayName: `Lifecycle Test ${Date.now()}`,
      description: null,
      route: 'manual',
      documents: ['operating_agreement'],
    })
    const key = created.serviceKey

    // Snapshot the created (version 1) row: its transitions + status + states + id.
    const before = await withSuperuser(async (client) => {
      const r = await client.query<{
        id: string
        version: number
        status: string
        transitions: Record<string, unknown>
        states: unknown
      }>(
        `SELECT id, version, status, transitions, states FROM workflow_definition
         WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
        [TENANT, key],
      )
      return r.rows[0]!
    })
    // A freshly created service has no lifecycle authored yet.
    expect(await getServiceLifecycle(attorneyCtx, key)).toBeNull()

    const res = await setServiceLifecycle(attorneyCtx, key, NC_SMLLC_AUTHORED)
    expect(res.serviceKey).toBe(key)
    // version+1 over the created row.
    expect(res.version).toBe(before.version + 1)

    // The graph is readable back through the API.
    const read = await getServiceLifecycle(attorneyCtx, key)
    expect(read).not.toBeNull()
    expect(read!.version).toBe(res.version)
    expect(read!.graph.map((s) => s.key)).toEqual(NC_SMLLC_AUTHORED.map((s) => s.key))

    // The new active row: graph in states, transitions carried forward, status kept,
    // and the prior row sealed.
    const after = await withSuperuser(async (client) => {
      const active = await client.query<{
        id: string
        version: number
        status: string
        transitions: Record<string, unknown>
        states: unknown
      }>(
        `SELECT id, version, status, transitions, states FROM workflow_definition
         WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
        [TENANT, key],
      )
      const sealed = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM workflow_definition
         WHERE tenant_id = $1 AND kind_name = $2 AND id = $3 AND valid_to IS NOT NULL`,
        [TENANT, key, before.id],
      )
      const configChange = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM configuration_change
         WHERE tenant_id = $1 AND target_table = 'workflow_definition'
           AND target_id = $2 AND change_kind = 'update'`,
        [TENANT, active.rows[0]!.id],
      )
      return {
        active: active.rows[0]!,
        sealedPrior: Number(sealed.rows[0]!.n),
        configChanges: Number(configChange.rows[0]!.n),
      }
    })

    // states now holds the authored graph…
    expect(Array.isArray(after.active.states)).toBe(true)
    expect((after.active.states as Lifecycle).map((s) => s.key)).toEqual(
      NC_SMLLC_AUTHORED.map((s) => s.key),
    )
    // …a brand-new id, version+1, prior row sealed.
    expect(after.active.id).not.toBe(before.id)
    expect(after.active.version).toBe(before.version + 1)
    expect(after.sealedPrior).toBe(1)
    // transitions carried forward verbatim (documents survived the authoring).
    expect(after.active.transitions.documents).toEqual(['operating_agreement'])
    // status kept (a created service starts 'deprecated'; authoring never flips it).
    expect(after.active.status).toBe(before.status)
    // a configuration_change row was appended for the new version.
    expect(after.configChanges).toBeGreaterThan(0)
  })

  it('rejects an invalid graph (two entry stages) and writes nothing', async () => {
    const created = await createService(attorneyCtx, {
      displayName: `Lifecycle Invalid ${Date.now()}`,
      description: null,
      route: 'manual',
    })
    const key = created.serviceKey

    await expect(setServiceLifecycle(attorneyCtx, key, INVALID_TWO_ENTRY)).rejects.toThrow(
      /Invalid workflow lifecycle/,
    )

    // No new version was written: still exactly one current row, and no lifecycle.
    expect(await getServiceLifecycle(attorneyCtx, key)).toBeNull()
    const versions = await withSuperuser(async (client) => {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM workflow_definition
         WHERE tenant_id = $1 AND kind_name = $2`,
        [TENANT, key],
      )
      return Number(r.rows[0]!.n)
    })
    expect(versions).toBe(1)
  })
})
