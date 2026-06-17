// Saved filter/sort views (beta sprint Obj 5). A saved_view entity holds a named
// view (surface + opaque config). create → list (firm-wide + surface-scoped) →
// update config → delete (archive removes it). DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  createSavedView,
  updateSavedView,
  deleteSavedView,
  getSavedView,
  listSavedViews,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Saved views (live DB)', { timeout: 120_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('creates, lists (firm-wide + scoped), updates and deletes a saved view', async () => {
    const tag = `view-${Date.now()}`
    const created = await createSavedView(ctx, {
      name: `${tag} Open matters`,
      surface: 'matters',
      config: {
        filters: [{ field: 'status', op: 'neq', value: 'closed' }],
        sort: { by: 'createdAt', dir: 'desc' },
      },
    })
    const id = created.savedViewId
    expect(created.surface).toBe('matters')
    expect(created.owner).toBe(ATTORNEY)
    expect(created.config).toMatchObject({ sort: { by: 'createdAt', dir: 'desc' } })

    // Listed firm-wide and when scoped to its surface; NOT under another surface.
    expect((await listSavedViews(ctx)).some((v) => v.savedViewId === id)).toBe(true)
    expect((await listSavedViews(ctx, 'matters')).some((v) => v.savedViewId === id)).toBe(true)
    expect((await listSavedViews(ctx, 'contacts')).some((v) => v.savedViewId === id)).toBe(false)

    // Update the config (rename + new sort).
    const updated = await updateSavedView(ctx, {
      savedViewId: id,
      name: `${tag} Open (by name)`,
      config: { filters: [], sort: { by: 'name', dir: 'asc' } },
    })
    expect(updated.name).toBe(`${tag} Open (by name)`)
    expect(updated.config).toMatchObject({ sort: { by: 'name', dir: 'asc' } })

    // Delete removes it from active listings.
    await deleteSavedView(ctx, id)
    expect(await getSavedView(ctx, id)).toBeNull()
    expect((await listSavedViews(ctx)).some((v) => v.savedViewId === id)).toBe(false)
  })
})
