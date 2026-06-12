// PR2 Questionnaire Editor acceptance on a live DB. Verifies the config-as-data
// contract for intake forms: update→get round-trips (and seals a prior version via
// the same upsert path), the repo-file fallback fires when no intake_schema is
// saved, an unknown service yields null, invalid schemas are rejected, and the
// three seeded services expose questionnaires (post-0011) whose field ids match
// the repo files.
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

run('service questionnaire editor (live DB)', { timeout: 90_000 }, () => {
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

  it('update → get round-trips the saved schema, and seals the prior version', async () => {
    const { createService, updateQuestionnaire, getQuestionnaire } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `PR2 Questionnaire ${randomUUID().slice(0, 8)}`,
    })
    const key = created.serviceKey

    const before = await activeRows(key)
    expect(before.rowCount).toBe(1)
    const v1 = before.rows[0]!
    expect(v1.version).toBe(1)

    const schema = {
      id: 'pr2-test-form',
      version: 1,
      title: 'PR2 test form',
      description: 'round-trip',
      jurisdiction: 'NC',
      sections: [
        {
          id: 'about',
          title: 'About',
          fields: [
            { id: 'company_name', label: 'Company name', type: 'text', required: true },
            {
              id: 'structure',
              label: 'Structure',
              type: 'select',
              required: true,
              options: ['a', 'b'],
            },
            {
              id: 'members',
              label: 'Members',
              type: 'members_repeater',
              required: true,
              minItems: 2,
              memberFields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
            },
          ],
        },
      ],
    }

    const saved = await updateQuestionnaire(ctx, key, schema)
    expect(saved.sections).toHaveLength(1)
    expect(saved.sections[0]!.fields.map((f) => f.id)).toEqual([
      'company_name',
      'structure',
      'members',
    ])

    const fetched = await getQuestionnaire(ctx, key)
    expect(fetched).toBeTruthy()
    expect(fetched!.title).toBe('PR2 test form')
    const select = fetched!.sections[0]!.fields.find((f) => f.id === 'structure')!
    expect(select.options).toEqual(['a', 'b'])
    const members = fetched!.sections[0]!.fields.find((f) => f.id === 'members')!
    expect(members.memberFields?.map((m) => m.id)).toEqual(['name'])

    // The write went through the versioned upsert path: version 2 is active, v1 sealed.
    const after = await activeRows(key)
    expect(after.rowCount).toBe(1)
    expect(after.rows[0]!.version).toBe(2)
    expect(after.rows[0]!.status).toBe('active')
    const sealed = await db.query<{ status: string; valid_to: string | null }>(
      `SELECT status, valid_to FROM workflow_definition WHERE id = $1`,
      [v1.id],
    )
    expect(sealed.rows[0]!.valid_to).not.toBeNull()
    expect(sealed.rows[0]!.status).toBe('deprecated')
  })

  it('falls back to the bound repo file when no intake_schema is saved', async () => {
    const { createService, getQuestionnaire } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `PR2 Fallback ${randomUUID().slice(0, 8)}`,
    })
    // Bind a known repo intake_form_id directly on the transitions of the current
    // row (no intake_schema). This is a test-only fixture write, not the action path.
    await db.query(
      `UPDATE workflow_definition
          SET transitions = jsonb_set(transitions, '{intake_form_id}', '"something-else-v1"'::jsonb, true)
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [TENANT, created.serviceKey],
    )

    const q = await getQuestionnaire(ctx, created.serviceKey)
    expect(q).toBeTruthy()
    // Matches the repo file intake-something-else.json.
    expect(q!.id).toBe('something-else-v1')
    expect(q!.sections[0]!.fields.map((f) => f.id)).toContain('matter_description')
  })

  it('returns null for an unknown service / unbound form', async () => {
    const { getQuestionnaire, createService } = await import('@exsto/legal')
    expect(await getQuestionnaire(ctx, `does_not_exist_${randomUUID().slice(0, 8)}`)).toBeNull()

    // A service with neither an intake_schema nor a resolvable repo file → null.
    const created = await createService(ctx, {
      displayName: `PR2 Unbound ${randomUUID().slice(0, 8)}`,
    })
    expect(await getQuestionnaire(ctx, created.serviceKey)).toBeNull()
  })

  it('rejects invalid schemas (unknown field type, bad select, missing ids)', async () => {
    const { createService, updateQuestionnaire } = await import('@exsto/legal')
    const created = await createService(ctx, {
      displayName: `PR2 Invalid ${randomUUID().slice(0, 8)}`,
    })
    const key = created.serviceKey

    await expect(
      updateQuestionnaire(ctx, key, {
        sections: [{ id: 's', title: 'S', fields: [{ id: 'x', label: 'X', type: 'boolean' }] }],
      }),
    ).rejects.toThrow(/unsupported type/i)

    await expect(
      updateQuestionnaire(ctx, key, {
        sections: [{ id: 's', title: 'S', fields: [{ id: 'x', label: 'X', type: 'select' }] }],
      }),
    ).rejects.toThrow(/options/i)

    await expect(
      updateQuestionnaire(ctx, key, {
        sections: [{ id: '', title: 'S', fields: [] }],
      }),
    ).rejects.toThrow(/id/i)

    await expect(updateQuestionnaire(ctx, key, { notSections: true })).rejects.toThrow(/sections/i)
  })

  it('the 3 seeded services expose questionnaires post-0011 matching repo field ids', async () => {
    const { getQuestionnaire } = await import('@exsto/legal')

    const single = await getQuestionnaire(ctx, 'nc_llc_single_member')
    expect(single).toBeTruthy()
    expect(single!.id).toBe('intake-questionnaire-oa')
    const singleFieldIds = single!.sections.flatMap((s) => s.fields.map((f) => f.id))
    expect(singleFieldIds).toContain('company_name')
    expect(singleFieldIds).toContain('management_structure')

    const multi = await getQuestionnaire(ctx, 'nc_llc_multi_member')
    expect(multi).toBeTruthy()
    expect(multi!.id).toBe('nc-llc-multi-member-v1')
    expect(multi!.sections.flatMap((s) => s.fields.map((f) => f.id))).toContain('member_count')

    const other = await getQuestionnaire(ctx, 'something_else')
    expect(other).toBeTruthy()
    expect(other!.id).toBe('something-else-v1')
    expect(other!.sections.flatMap((s) => s.fields.map((f) => f.id))).toContain(
      'matter_description',
    )
  })
})
