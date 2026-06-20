// Question library (migration 0077). A `question_template` entity is a reusable
// single intake question with a stable {{answer}} token. create → list/get →
// "save again" upserts by token (no duplicate) → update (incl. type change that
// clears stale options) → archive removes it. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  createQuestionTemplate,
  updateQuestionTemplate,
  archiveQuestionTemplate,
  getQuestionTemplate,
  listQuestionTemplates,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('Question library (live DB)', { timeout: 120_000 }, () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('creates, upserts-by-token, retypes (clearing options) and archives a library question', async () => {
    const tag = `qlib_${Date.now()}`
    const label = `${tag} registered agent`

    // create → token derived from the label (snake_case slug).
    const created = await createQuestionTemplate(ctx, { label, type: 'text' })
    expect(created.type).toBe('text')
    expect(created.token).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(created.options).toBeNull()
    const id = created.questionTemplateId

    // Listed + fetchable.
    expect((await listQuestionTemplates(ctx)).some((q) => q.questionTemplateId === id)).toBe(true)
    expect((await getQuestionTemplate(ctx, id))?.label).toBe(label)

    // "Save again" with the SAME token upserts — updates in place, no duplicate.
    const again = await createQuestionTemplate(ctx, {
      label: `${label} (revised)`,
      type: 'text',
      token: created.token,
    })
    expect(again.questionTemplateId).toBe(id)
    expect(again.label).toBe(`${label} (revised)`)
    const sameToken = (await listQuestionTemplates(ctx)).filter((q) => q.token === created.token)
    expect(sameToken).toHaveLength(1)

    // Retype to a multi-select with choices.
    const checked = await updateQuestionTemplate(ctx, {
      questionTemplateId: id,
      type: 'checkbox',
      options: ['LLC', 'S-Corp', 'C-Corp'],
    })
    expect(checked.type).toBe('checkbox')
    expect(checked.options).toEqual(['LLC', 'S-Corp', 'C-Corp'])

    // Retype back to a non-option type → stale choices are cleared.
    const plain = await updateQuestionTemplate(ctx, { questionTemplateId: id, type: 'text' })
    expect(plain.type).toBe('text')
    expect(plain.options).toBeNull()

    // Archive removes it from active listings.
    await archiveQuestionTemplate(ctx, id)
    expect((await listQuestionTemplates(ctx)).some((q) => q.questionTemplateId === id)).toBe(false)
    expect(await getQuestionTemplate(ctx, id)).toBeNull()
  })
})
