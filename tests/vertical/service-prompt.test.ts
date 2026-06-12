// PR3 Drafting-Prompt Editor acceptance on a live DB. Verifies the config-as-data
// contract for drafting prompts (per document kind): update→get round-trips and
// seals a prior version via the same upsert path, bumps drafting.prompt_version,
// the repo-file fallback fires when no config prompt is saved, an unknown service
// yields null, prompts missing a required mustache slot are rejected, and the
// single-member service exposes its seeded prompt post-0012. Also exercises the
// pure resolver (resolveDraftingPromptDoc) without a DB so the config-first
// selection logic is covered even when no DB URL is wired.
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

const REQUIRED_SLOTS = [
  '{{questionnaire_responses_json}}',
  '{{transcript_text}}',
  '{{operating_agreement_template}}',
]

// A minimal, valid prompt: contains all three required slots.
function validPrompt(tag: string): string {
  return [
    `Draft instructions ${tag}.`,
    '',
    '## Questionnaire',
    '{{questionnaire_responses_json}}',
    '## Transcript',
    '{{transcript_text}}',
    '## Template',
    '{{operating_agreement_template}}',
  ].join('\n')
}

// ── Pure-resolver coverage (no DB) ──────────────────────────────────────────
// Generous timeout: the first dynamic import('@exsto/legal') cold-loads the whole
// package (and pg), which can exceed the 5s default on a cold run even though the
// resolver itself is synchronous.
describe('resolveDraftingPromptDoc (pure)', { timeout: 90_000 }, () => {
  it('prefers the config prompt and reports its version', async () => {
    const { resolveDraftingPromptDoc } = await import('@exsto/legal')
    const doc = resolveDraftingPromptDoc(
      { prompt_version: 3, prompts: { operating_agreement: validPrompt('cfg') } },
      'svc',
      'operating_agreement',
    )
    expect(doc.source).toBe('config')
    expect(doc.promptVersion).toBe(3)
    expect(doc.promptText).toContain('{{questionnaire_responses_json}}')
  })

  it('falls back to the repo prompt when the kind has no config prompt', async () => {
    const { resolveDraftingPromptDoc } = await import('@exsto/legal')
    const doc = resolveDraftingPromptDoc(
      { prompt_version: 1, prompts: { engagement_letter: validPrompt('el') } },
      'svc',
      'operating_agreement',
    )
    expect(doc.source).toBe('repo')
    expect(doc.promptVersion).toBeNull()
    // The bundled repo prompt contains the required slots.
    for (const slot of REQUIRED_SLOTS) expect(doc.promptText).toContain(slot)
  })

  it('falls back to the repo prompt when there is no drafting config at all', async () => {
    const { resolveDraftingPromptDoc } = await import('@exsto/legal')
    const doc = resolveDraftingPromptDoc(undefined, 'svc', 'operating_agreement')
    expect(doc.source).toBe('repo')
    expect(doc.requiredSlots).toEqual(REQUIRED_SLOTS)
  })
})

describe('validateDraftingPrompt / missingDraftingSlots (pure)', { timeout: 90_000 }, () => {
  it('rejects a prompt missing the questionnaire slot', async () => {
    const { validateDraftingPrompt } = await import('@exsto/legal')
    const bad = validPrompt('x').replace('{{questionnaire_responses_json}}', '')
    expect(() => validateDraftingPrompt(bad)).toThrow(/questionnaire_responses_json/)
  })

  it('rejects a prompt missing the transcript slot', async () => {
    const { validateDraftingPrompt } = await import('@exsto/legal')
    const bad = validPrompt('x').replace('{{transcript_text}}', '')
    expect(() => validateDraftingPrompt(bad)).toThrow(/transcript_text/)
  })

  it('rejects a prompt missing the document-body slot', async () => {
    const { validateDraftingPrompt } = await import('@exsto/legal')
    const bad = validPrompt('x').replace('{{operating_agreement_template}}', '')
    expect(() => validateDraftingPrompt(bad)).toThrow(/operating_agreement_template/)
  })

  it('rejects empty / non-string prompts', async () => {
    const { validateDraftingPrompt } = await import('@exsto/legal')
    expect(() => validateDraftingPrompt('   ')).toThrow(/non-empty/i)
    expect(() => validateDraftingPrompt(42 as unknown)).toThrow(/non-empty/i)
  })

  it('reports exactly the missing slots', async () => {
    const { missingDraftingSlots } = await import('@exsto/legal')
    expect(missingDraftingSlots(validPrompt('ok'))).toEqual([])
    const bad = validPrompt('x').replace('{{transcript_text}}', '')
    expect(missingDraftingSlots(bad)).toEqual(['{{transcript_text}}'])
  })
})

// ── Live-DB round-trip coverage ─────────────────────────────────────────────
run('service drafting-prompt editor (live DB)', { timeout: 90_000 }, () => {
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

  async function draftingConfig(kindName: string) {
    const r = await db.query<{
      drafting: { prompt_version?: number; prompts?: Record<string, string> } | null
    }>(
      `SELECT transitions->'drafting' AS drafting FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [TENANT, kindName],
    )
    return r.rows[0]?.drafting ?? null
  }

  it('update → get round-trips, seals the prior version, and bumps prompt_version', async () => {
    const { createService, updateDraftingPrompt, getDraftingPrompt } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `PR3 Prompt ${randomUUID().slice(0, 8)}`,
      documents: ['operating_agreement', 'engagement_letter'],
    })
    const key = created.serviceKey

    const before = await activeRows(key)
    expect(before.rowCount).toBe(1)
    const v1 = before.rows[0]!
    expect(v1.version).toBe(1)

    const promptText = validPrompt('round-trip')
    const saved = await updateDraftingPrompt(ctx, key, 'operating_agreement', promptText)
    expect(saved.source).toBe('config')
    expect(saved.promptText).toBe(promptText)
    expect(saved.promptVersion).toBe(1)

    const fetched = await getDraftingPrompt(ctx, key, 'operating_agreement')
    expect(fetched).toBeTruthy()
    expect(fetched!.promptText).toBe(promptText)
    expect(fetched!.source).toBe('config')
    expect(fetched!.promptVersion).toBe(1)

    // Versioned upsert path: version 2 is the current row, v1 sealed. (PR4: the
    // new version carries the prior status forward — a freshly created service is
    // disabled, so the current row stays 'deprecated'. The contract here is the
    // bitemporal seal + prompt_version bump, not the enabled status.)
    const after = await activeRows(key)
    expect(after.rowCount).toBe(1)
    expect(after.rows[0]!.version).toBe(2)
    expect(after.rows[0]!.status).toBe('deprecated')
    const sealed = await db.query<{ status: string; valid_to: string | null }>(
      `SELECT status, valid_to FROM workflow_definition WHERE id = $1`,
      [v1.id],
    )
    expect(sealed.rows[0]!.valid_to).not.toBeNull()
    expect(sealed.rows[0]!.status).toBe('deprecated')

    // A second save bumps prompt_version to 2 and preserves the sibling kind.
    const elText = validPrompt('engagement')
    const savedEl = await updateDraftingPrompt(ctx, key, 'engagement_letter', elText)
    expect(savedEl.promptVersion).toBe(2)

    const cfg = await draftingConfig(key)
    expect(cfg?.prompt_version).toBe(2)
    expect(cfg?.prompts?.operating_agreement).toBe(promptText)
    expect(cfg?.prompts?.engagement_letter).toBe(elText)
  })

  it('falls back to the repo prompt when no config prompt is saved', async () => {
    const { createService, getDraftingPrompt } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `PR3 Fallback ${randomUUID().slice(0, 8)}`,
      documents: ['operating_agreement'],
    })
    const doc = await getDraftingPrompt(ctx, created.serviceKey, 'operating_agreement')
    expect(doc).toBeTruthy()
    expect(doc!.source).toBe('repo')
    expect(doc!.promptVersion).toBeNull()
    for (const slot of REQUIRED_SLOTS) expect(doc!.promptText).toContain(slot)
  })

  it('returns null for an unknown service', async () => {
    const { getDraftingPrompt } = await import('@exsto/legal')
    expect(
      await getDraftingPrompt(
        ctx,
        `does_not_exist_${randomUUID().slice(0, 8)}`,
        'operating_agreement',
      ),
    ).toBeNull()
  })

  it('rejects prompts missing a required slot', async () => {
    const { createService, updateDraftingPrompt } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `PR3 Invalid ${randomUUID().slice(0, 8)}`,
      documents: ['operating_agreement'],
    })
    const key = created.serviceKey
    const bad = validPrompt('x').replace('{{operating_agreement_template}}', '')
    await expect(updateDraftingPrompt(ctx, key, 'operating_agreement', bad)).rejects.toThrow(
      /operating_agreement_template/,
    )
    // The rejected save did NOT create a new version.
    const rows = await activeRows(key)
    expect(rows.rows[0]!.version).toBe(1)
  })

  it('the single-member service exposes its seeded prompt post-0012', async () => {
    const { getDraftingPrompt } = await import('@exsto/legal')
    const oa = await getDraftingPrompt(ctx, 'nc_llc_single_member', 'operating_agreement')
    expect(oa).toBeTruthy()
    expect(oa!.source).toBe('config')
    expect(oa!.promptVersion).toBe(1)
    for (const slot of REQUIRED_SLOTS) expect(oa!.promptText).toContain(slot)
    expect(oa!.promptText).toContain('North Carolina LLC operating agreement')

    const el = await getDraftingPrompt(ctx, 'nc_llc_single_member', 'engagement_letter')
    expect(el).toBeTruthy()
    expect(el!.source).toBe('config')
    for (const slot of REQUIRED_SLOTS) expect(el!.promptText).toContain(slot)
  })
})
