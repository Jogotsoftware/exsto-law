// Standalone templates (beta sprint Obj 9). A `template` entity is a reusable
// document/email template not bound to a service. create → list/get → it appears
// in the Templates catalog (standalone:true) → update → archive removes it. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  createTemplate,
  updateTemplate,
  archiveTemplate,
  getStandaloneTemplate,
  listStandaloneTemplates,
  listTemplatesCatalog,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Standalone templates (live DB)', { timeout: 120_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('creates, lists, catalogs, updates and archives a standalone template', async () => {
    const tag = `tpl-${Date.now()}`
    const created = await createTemplate(ctx, {
      name: `${tag} NDA`,
      category: 'document',
      body: 'This Mutual NDA is between {{client_full_name}} and the firm.',
      docKind: 'nda',
    })
    expect(created.category).toBe('document')
    expect(created.docKind).toBe('nda')
    const id = created.templateEntityId

    // Listed and individually fetchable.
    expect((await listStandaloneTemplates(ctx)).some((t) => t.templateEntityId === id)).toBe(true)
    expect((await getStandaloneTemplate(ctx, id))?.name).toBe(`${tag} NDA`)

    // Appears in the aggregate catalog under documents, flagged standalone.
    const inCatalog = (await listTemplatesCatalog(ctx)).documents.find(
      (e) => e.templateEntityId === id,
    )
    expect(inCatalog?.standalone).toBe(true)
    expect(inCatalog?.serviceKey).toBeNull()
    expect(inCatalog?.hasContent).toBe(true)

    // Update the body.
    const updated = await updateTemplate(ctx, { templateEntityId: id, body: 'Revised NDA body.' })
    expect(updated.body).toBe('Revised NDA body.')

    // Archive removes it from active listings.
    await archiveTemplate(ctx, id)
    expect((await listStandaloneTemplates(ctx)).some((t) => t.templateEntityId === id)).toBe(false)
    expect(await getStandaloneTemplate(ctx, id)).toBeNull()
  })
})
