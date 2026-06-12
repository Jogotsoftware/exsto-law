// PR1 Service Library acceptance on a live DB. Verifies the versioned-config
// contract: update seals the prior active row + inserts version+1 (exactly one
// active row per kind_name), set_active disable/enable round-trips, new services
// appear in list_all and are tenant-scoped, and the seeded services still list
// with their seeded routes after the 0010 sort_order backfill (single = auto).
//
// DB-gated like tests/invariants: skips (not fails) when no DB URL is wired.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'

run('service library (live DB)', { timeout: 90_000 }, () => {
  const ctx = { tenantId: TENANT, actorId: ATTORNEY }
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  async function activeRows(kindName: string) {
    return db.query<{ id: string; version: number; status: string; valid_to: string | null }>(
      `SELECT id, version, status, valid_to FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [TENANT, kindName],
    )
  }

  it('seeded services still list with their seeded routes (single-member = auto)', async () => {
    const { listServices } = await import('@exsto/legal')
    const services = await listServices(ctx)
    const byKey = new Map(services.map((s) => [s.serviceKey, s]))

    const single = byKey.get('nc_llc_single_member')
    expect(single).toBeTruthy()
    expect(single!.route).toBe('auto')
    expect(single!.isActive).toBe(true)
    // on_transcript gate is preserved on the transitions row (drives auto-draft).
    const t = await db.query<{ on_transcript: string; route: string }>(
      `SELECT transitions->>'on_transcript' AS on_transcript, transitions->>'route' AS route
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = 'nc_llc_single_member' AND valid_to IS NULL`,
      [TENANT],
    )
    expect(t.rows[0]?.route).toBe('auto')
    expect(t.rows[0]?.on_transcript).toBe('draft.generate')

    expect(byKey.get('nc_llc_multi_member')?.route).toBe('manual')
    expect(byKey.get('something_else')?.route).toBe('manual')

    // sort_order backfill keeps the seeded display order stable.
    const keys = services.map((s) => s.serviceKey)
    expect(keys.indexOf('nc_llc_single_member')).toBeLessThan(keys.indexOf('nc_llc_multi_member'))
    expect(keys.indexOf('nc_llc_multi_member')).toBeLessThan(keys.indexOf('something_else'))
  })

  it('create → appears in list_all (incl. inactive); tenant-scoped', async () => {
    const { createService, listServicesIncludingInactive } = await import('@exsto/legal')
    const name = `PR1 Test Service ${randomUUID().slice(0, 8)}`
    const created = await createService(ctx, {
      displayName: name,
      description: 'created by service-library test',
    })
    expect(created.serviceKey).toBeTruthy()
    // PR4: a brand-new service is created DISABLED (no questionnaire yet) so it
    // stays off the public booking page until the attorney finishes + enables it.
    expect(created.isActive).toBe(false)
    // metadata-only create has no intake form yet → defaults to manual route.
    expect(created.route).toBe('manual')

    const all = await listServicesIncludingInactive(ctx)
    expect(all.some((s) => s.serviceKey === created.serviceKey)).toBe(true)

    // Tenant-scoped: the row is stamped with this tenant only.
    const rows = await db.query<{ c: string }>(
      `SELECT count(*) AS c FROM workflow_definition
       WHERE kind_name = $1 AND tenant_id <> $2`,
      [created.serviceKey, TENANT],
    )
    expect(Number(rows.rows[0]!.c)).toBe(0)
  })

  it('update seals the prior active row and inserts version+1 (exactly one active)', async () => {
    const { createService, updateQuestionnaire, setServiceActive, updateServiceMetadata } =
      await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `PR1 Versioned ${randomUUID().slice(0, 8)}`,
    })
    const key = created.serviceKey

    // PR4: a new service is created disabled. Give it a questionnaire and enable
    // it, so version 1 is the live (active) row before the metadata edit. This
    // also proves the new invariant: editing a LIVE service keeps it live
    // (status carries forward across the versioned upsert).
    await updateQuestionnaire(ctx, key, {
      sections: [{ id: 's', title: 'S', fields: [{ id: 'q', label: 'Q', type: 'text' }] }],
    })
    await setServiceActive(ctx, key, true)

    const before = await activeRows(key)
    expect(before.rowCount).toBe(1)
    const v1 = before.rows[0]!
    // version 2 here: create=v1, updateQuestionnaire sealed v1 and inserted v2.
    expect(v1.status).toBe('active')

    const updated = await updateServiceMetadata(ctx, {
      serviceKey: key,
      displayName: `${created.displayName} (renamed)`,
      description: 'v2 description',
    })
    expect(updated.displayName).toContain('(renamed)')

    // Exactly one active (valid_to IS NULL) row, and it is the next version.
    const after = await activeRows(key)
    expect(after.rowCount).toBe(1)
    expect(after.rows[0]!.version).toBe(v1.version + 1)
    // Editing a live service keeps it live: status carried forward.
    expect(after.rows[0]!.status).toBe('active')

    // The prior row is sealed: valid_to set, status deprecated.
    const sealed = await db.query<{ status: string; valid_to: string | null }>(
      `SELECT status, valid_to FROM workflow_definition WHERE id = $1`,
      [v1.id],
    )
    expect(sealed.rows[0]!.valid_to).not.toBeNull()
    expect(sealed.rows[0]!.status).toBe('deprecated')
  })

  it('set_active disable drops from listServices but the row persists; re-enable restores', async () => {
    const {
      createService,
      updateQuestionnaire,
      setServiceActive,
      listServices,
      listServicesIncludingInactive,
    } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `PR1 Toggle ${randomUUID().slice(0, 8)}`,
    })
    const key = created.serviceKey

    // PR4: give the (manual-route) service a questionnaire so the enable gate is
    // satisfied. New services are created disabled, so enable it first.
    await updateQuestionnaire(ctx, key, {
      sections: [{ id: 's', title: 'S', fields: [{ id: 'q', label: 'Q', type: 'text' }] }],
    })
    await setServiceActive(ctx, key, true)
    expect((await listServices(ctx)).some((s) => s.serviceKey === key)).toBe(true)

    // Disable.
    const off = await setServiceActive(ctx, key, false)
    expect(off.status).toBe('deprecated')
    expect((await listServices(ctx)).some((s) => s.serviceKey === key)).toBe(false)
    // Still present (and current) in the admin list.
    expect(
      (await listServicesIncludingInactive(ctx)).some((s) => s.serviceKey === key && !s.isActive),
    ).toBe(true)
    // Row persists.
    expect((await activeRows(key)).rowCount).toBe(1)

    // Re-enable.
    const on = await setServiceActive(ctx, key, true)
    expect(on.status).toBe('active')
    expect((await listServices(ctx)).some((s) => s.serviceKey === key)).toBe(true)
  })
})
