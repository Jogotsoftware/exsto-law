// Templates catalog (beta sprint Obj 9). listTemplatesCatalog aggregates the
// firm's templates across three categories over the existing library layer (no
// parallel store): a form per service, a document-body entry per (service,
// configured kind), and the firm's email templates. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { listTemplatesCatalog, listNotificationTemplateRefs } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Templates catalog (live DB)', { timeout: 120_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('aggregates forms, document templates and email templates', async () => {
    const catalog = await listTemplatesCatalog(attorneyCtx)

    // Emails: exactly the firm's notification template set, all builtin.
    const refs = listNotificationTemplateRefs()
    expect(catalog.emails.length).toBe(refs.length)
    expect(catalog.emails.every((e) => e.source === 'builtin' && e.category === 'email')).toBe(true)
    expect(catalog.emails.every((e) => e.hasContent)).toBe(true)

    // Forms: one per service, keyed and well-formed.
    expect(catalog.forms.length).toBeGreaterThan(0)
    for (const f of catalog.forms) {
      expect(f.category).toBe('form')
      expect(f.key).toBe(`form:${f.serviceKey}`)
      expect(f.serviceKey).toBeTruthy()
      expect(typeof f.isActive).toBe('boolean')
    }

    // Documents: each has a resolved source and belongs to a service.
    for (const d of catalog.documents) {
      expect(d.category).toBe('document')
      expect(d.key).toBe(`document:${d.serviceKey}:${d.documentKind}`)
      expect(['config', 'repo', 'none']).toContain(d.source)
      // 'none' means not authored yet → no content; otherwise content resolved.
      expect(d.hasContent).toBe(d.source !== 'none')
    }

    // At least one configured operating-agreement body resolves to real content.
    const oa = catalog.documents.find((d) => d.documentKind === 'operating_agreement')
    if (oa) expect(oa.hasContent).toBe(true)
  })
})
