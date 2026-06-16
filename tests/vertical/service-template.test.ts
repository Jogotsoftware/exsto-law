// Doc-Types PR1 (Document-Template Editor) acceptance on a live DB. Verifies the
// config-as-data contract for the document BODY template (per document kind):
// update→get round-trips and seals a prior version via the same upsert path, bumps
// document_templates.template_version, the repo-file fallback fires for the two
// bundled kinds when no config template is saved, an unknown service yields null,
// empty templates are rejected, and — the keystone — an auto service drafting a
// NOVEL document kind (no bundled body) is not enableable until a template is
// authored in-app. Also exercises the pure resolver (resolveDocumentTemplateDoc)
// and the completeness gate (completenessFromTransitions) without a DB.
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

// A minimal valid drafting prompt (contains all three required slots) — needed so an
// auto service can be complete enough that the template requirement is the LAST gap.
function validPrompt(tag: string): string {
  return [
    `Draft instructions ${tag}.`,
    '{{questionnaire_responses_json}}',
    '{{transcript_text}}',
    '{{operating_agreement_template}}',
  ].join('\n')
}

const oneFieldQuestionnaire = {
  title: 'Q',
  sections: [{ id: 's1', title: 'S1', fields: [{ id: 'f1', label: 'F1', type: 'text' }] }],
}

// ── Pure-resolver coverage (no DB) ──────────────────────────────────────────
// Generous timeout: the first dynamic import('@exsto/legal') cold-loads the whole
// package (and pg + the bundled template files), which can exceed the 5s default.
describe('resolveDocumentTemplateDoc (pure)', { timeout: 90_000 }, () => {
  it('prefers the config template and reports its version', async () => {
    const { resolveDocumentTemplateDoc } = await import('@exsto/legal')
    const doc = resolveDocumentTemplateDoc(
      { template_version: 4, templates: { operating_agreement: '# Custom body' } },
      'svc',
      'operating_agreement',
    )
    expect(doc.source).toBe('config')
    expect(doc.templateVersion).toBe(4)
    expect(doc.templateText).toBe('# Custom body')
  })

  it('falls back to the repo body for a bundled kind with no config template', async () => {
    const { resolveDocumentTemplateDoc } = await import('@exsto/legal')
    const oa = resolveDocumentTemplateDoc(undefined, 'svc', 'operating_agreement')
    expect(oa.source).toBe('repo')
    expect(oa.templateVersion).toBeNull()
    expect(oa.templateText && oa.templateText.length).toBeGreaterThan(0)

    const el = resolveDocumentTemplateDoc({ templates: {} }, 'svc', 'engagement_letter')
    expect(el.source).toBe('repo')
    expect(el.templateText && el.templateText.length).toBeGreaterThan(0)
  })

  it('is service-aware for the operating-agreement repo fallback (multi-member body)', async () => {
    const { resolveDocumentTemplateDoc, loadMultiMemberOperatingAgreementTemplate } =
      await import('@exsto/legal')
    const multi = resolveDocumentTemplateDoc(
      undefined,
      'nc_llc_multi_member',
      'operating_agreement',
    )
    expect(multi.source).toBe('repo')
    expect(multi.templateText).toBe(loadMultiMemberOperatingAgreementTemplate())
  })

  it('reports source "none" for a novel kind with no config and no repo body', async () => {
    const { resolveDocumentTemplateDoc } = await import('@exsto/legal')
    const doc = resolveDocumentTemplateDoc({ templates: {} }, 'svc', 'non_disclosure_agreement')
    expect(doc.source).toBe('none')
    expect(doc.templateText).toBeNull()
    expect(doc.templateVersion).toBeNull()
  })
})

describe('validateDocumentTemplate / hasRepoTemplate (pure)', { timeout: 90_000 }, () => {
  it('rejects empty / non-string templates', async () => {
    const { validateDocumentTemplate } = await import('@exsto/legal')
    expect(() => validateDocumentTemplate('   ')).toThrow(/non-empty/i)
    expect(() => validateDocumentTemplate(42 as unknown)).toThrow(/non-empty/i)
    expect(validateDocumentTemplate('# A body')).toBe('# A body')
  })

  it('knows which kinds ship a bundled repo body', async () => {
    const { hasRepoTemplate } = await import('@exsto/legal')
    expect(hasRepoTemplate('operating_agreement')).toBe(true)
    expect(hasRepoTemplate('engagement_letter')).toBe(true)
    expect(hasRepoTemplate('non_disclosure_agreement')).toBe(false)
  })
})

describe('completenessFromTransitions — template requirement (pure)', { timeout: 90_000 }, () => {
  it('flags a novel auto kind that has a prompt but no body template', async () => {
    const { completenessFromTransitions } = await import('@exsto/legal')
    const c = completenessFromTransitions('svc', {
      route: 'auto',
      documents: ['non_disclosure_agreement'],
      intake_schema: oneFieldQuestionnaire as never,
      drafting: { prompt_version: 1, prompts: { non_disclosure_agreement: validPrompt('nda') } },
      // no document_templates → the novel kind has no resolvable body
    })
    expect(c.ready).toBe(false)
    expect(c.missing.join(' ')).toMatch(/template/i)
    expect(c.missing.join(' ')).toMatch(/non_disclosure_agreement/)
  })

  it('a bundled kind is satisfied by its repo body (no config template needed)', async () => {
    const { completenessFromTransitions } = await import('@exsto/legal')
    const c = completenessFromTransitions('svc', {
      route: 'auto',
      documents: ['operating_agreement'],
      intake_schema: oneFieldQuestionnaire as never,
      drafting: { prompt_version: 1, prompts: { operating_agreement: validPrompt('oa') } },
    })
    expect(c.ready).toBe(true)
    expect(c.missing).toEqual([])
  })

  it('a config template satisfies the requirement for a novel kind', async () => {
    const { completenessFromTransitions } = await import('@exsto/legal')
    const c = completenessFromTransitions('svc', {
      route: 'auto',
      documents: ['non_disclosure_agreement'],
      intake_schema: oneFieldQuestionnaire as never,
      drafting: { prompt_version: 1, prompts: { non_disclosure_agreement: validPrompt('nda') } },
      document_templates: {
        template_version: 1,
        templates: {
          non_disclosure_agreement: '# Mutual NDA\n\nBetween {{party_a}} and {{party_b}}.',
        },
      },
    })
    expect(c.ready).toBe(true)
    expect(c.missing).toEqual([])
  })
})

// ── Live-DB round-trip coverage ─────────────────────────────────────────────
run('service document-template editor (live DB)', { timeout: 90_000 }, () => {
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

  async function templateConfig(kindName: string) {
    const r = await db.query<{
      tpl: { template_version?: number; templates?: Record<string, string> } | null
    }>(
      `SELECT transitions->'document_templates' AS tpl FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [TENANT, kindName],
    )
    return r.rows[0]?.tpl ?? null
  }

  it('update → get round-trips, seals the prior version, and bumps template_version', async () => {
    const { createService, updateDocumentTemplate, getDocumentTemplate } =
      await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `DT Template ${randomUUID().slice(0, 8)}`,
      documents: ['operating_agreement', 'engagement_letter'],
    })
    const key = created.serviceKey

    const before = await activeRows(key)
    expect(before.rowCount).toBe(1)
    expect(before.rows[0]!.version).toBe(1)
    const v1Id = before.rows[0]!.id

    const body = '# Operating Agreement (custom)\n\nArticle I…'
    const saved = await updateDocumentTemplate(ctx, key, 'operating_agreement', body)
    expect(saved.source).toBe('config')
    expect(saved.templateText).toBe(body)
    expect(saved.templateVersion).toBe(1)

    const fetched = await getDocumentTemplate(ctx, key, 'operating_agreement')
    expect(fetched!.templateText).toBe(body)
    expect(fetched!.source).toBe('config')

    // Versioned upsert: version 2 current, v1 sealed.
    const after = await activeRows(key)
    expect(after.rows[0]!.version).toBe(2)
    const sealed = await db.query<{ valid_to: string | null }>(
      `SELECT valid_to FROM workflow_definition WHERE id = $1`,
      [v1Id],
    )
    expect(sealed.rows[0]!.valid_to).not.toBeNull()

    // A second save bumps template_version and preserves the sibling kind.
    const elBody = '# Engagement Letter (custom)\n\nDear client…'
    const savedEl = await updateDocumentTemplate(ctx, key, 'engagement_letter', elBody)
    expect(savedEl.templateVersion).toBe(2)

    const cfg = await templateConfig(key)
    expect(cfg?.template_version).toBe(2)
    expect(cfg?.templates?.operating_agreement).toBe(body)
    expect(cfg?.templates?.engagement_letter).toBe(elBody)
  })

  it('falls back to the repo body when no config template is saved', async () => {
    const { createService, getDocumentTemplate } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `DT Fallback ${randomUUID().slice(0, 8)}`,
      documents: ['operating_agreement'],
    })
    const doc = await getDocumentTemplate(ctx, created.serviceKey, 'operating_agreement')
    expect(doc!.source).toBe('repo')
    expect(doc!.templateVersion).toBeNull()
    expect(doc!.templateText && doc!.templateText.length).toBeGreaterThan(0)
  })

  it('returns null for an unknown service', async () => {
    const { getDocumentTemplate } = await import('@exsto/legal')
    expect(
      await getDocumentTemplate(ctx, `nope_${randomUUID().slice(0, 8)}`, 'operating_agreement'),
    ).toBeNull()
  })

  it('rejects an empty template and does not create a new version', async () => {
    const { createService, updateDocumentTemplate } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `DT Invalid ${randomUUID().slice(0, 8)}`,
      documents: ['operating_agreement'],
    })
    const key = created.serviceKey
    await expect(updateDocumentTemplate(ctx, key, 'operating_agreement', '   ')).rejects.toThrow(
      /non-empty/i,
    )
    const rows = await activeRows(key)
    expect(rows.rows[0]!.version).toBe(1)
  })

  it('KEYSTONE: a novel-kind auto service is unenableable until its template is authored', async () => {
    const {
      createService,
      updateQuestionnaire,
      updateDraftingPrompt,
      updateDocumentTemplate,
      serviceCompleteness,
    } = await import('@exsto/legal')

    const created = await createService(ctx, {
      displayName: `DT NDA ${randomUUID().slice(0, 8)}`,
      route: 'auto',
      documents: ['non_disclosure_agreement'],
    })
    const key = created.serviceKey

    await updateQuestionnaire(ctx, key, oneFieldQuestionnaire)
    await updateDraftingPrompt(ctx, key, 'non_disclosure_agreement', validPrompt('nda'))

    // Questionnaire + prompt present, but the novel kind has no body template yet.
    const before = await serviceCompleteness(ctx, key)
    expect(before.ready).toBe(false)
    expect(before.missing.join(' ')).toMatch(/template/i)

    await updateDocumentTemplate(
      ctx,
      key,
      'non_disclosure_agreement',
      '# Mutual NDA\n\nBetween the parties…',
    )

    // With the template authored — fully config-built, zero code — it is ready.
    const after = await serviceCompleteness(ctx, key)
    expect(after.ready).toBe(true)
    expect(after.missing).toEqual([])
  })
})
