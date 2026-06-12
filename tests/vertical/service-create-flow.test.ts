// PR4 Service-create capstone on a live DB. Proves an attorney can stand up a
// brand-new service end-to-end and a client can then book it — with the ENABLE
// GATE enforced at every step:
//
//   createService (disabled, manual)            → NOT in public listServices
//   setServiceActive(true)                       → throws "needs a questionnaire"
//   updateQuestionnaire                          → now enableable (manual)
//   (auto variant) updateServiceMetadata route=auto + documents
//                                                → setServiceActive(true) throws "needs a drafting prompt"
//   updateDraftingPrompt for each document kind  → setServiceActive(true) succeeds
//   now appears in public listServices           → submitBooking creates a matter
//
// Also covers: the pure completeness rules (no DB), and tenant-scoping of the new
// service row. DB-gated like tests/invariants: skips (not fails) with no DB URL.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'

function validPrompt(tag: string): string {
  return [
    `Draft instructions ${tag}.`,
    '{{questionnaire_responses_json}}',
    '{{transcript_text}}',
    '{{operating_agreement_template}}',
  ].join('\n')
}

const oneFieldQuestionnaire = {
  id: 'pr4-form',
  version: 1,
  title: 'PR4 intake',
  sections: [
    {
      id: 'about',
      title: 'About',
      fields: [
        { id: 'matter_description', label: 'What do you need?', type: 'text', required: true },
      ],
    },
  ],
}

// A weekday slot randomized far into the future so booking reruns never collide.
function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 60 + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

// ── Pure completeness rules (no DB) ─────────────────────────────────────────
describe('computeCompleteness (pure)', { timeout: 90_000 }, () => {
  it('manual service is ready once it has a questionnaire', async () => {
    const { computeCompleteness } = await import('@exsto/legal')
    const empty = computeCompleteness({
      serviceKey: 's',
      route: 'manual',
      documents: [],
      intakeSchema: undefined,
      promptByKind: {},
    })
    expect(empty.ready).toBe(false)
    expect(empty.missing.join(' ')).toMatch(/questionnaire/i)

    const withQ = computeCompleteness({
      serviceKey: 's',
      route: 'manual',
      documents: ['operating_agreement'],
      intakeSchema: oneFieldQuestionnaire as never,
      promptByKind: {},
    })
    // Manual route ignores prompts entirely.
    expect(withQ.ready).toBe(true)
    expect(withQ.missing).toEqual([])
  })

  it('auto service needs a prompt with all slots for every document kind', async () => {
    const { computeCompleteness } = await import('@exsto/legal')
    const noPrompt = computeCompleteness({
      serviceKey: 's',
      route: 'auto',
      documents: ['operating_agreement', 'engagement_letter'],
      intakeSchema: oneFieldQuestionnaire as never,
      promptByKind: { operating_agreement: validPrompt('oa'), engagement_letter: null },
    })
    expect(noPrompt.ready).toBe(false)
    expect(noPrompt.missing.join(' ')).toMatch(/engagement_letter/)

    const badSlots = computeCompleteness({
      serviceKey: 's',
      route: 'auto',
      documents: ['operating_agreement'],
      intakeSchema: oneFieldQuestionnaire as never,
      promptByKind: {
        operating_agreement: validPrompt('oa').replace('{{transcript_text}}', ''),
      },
    })
    expect(badSlots.ready).toBe(false)
    expect(badSlots.missing.join(' ')).toMatch(/transcript_text/)

    const ok = computeCompleteness({
      serviceKey: 's',
      route: 'auto',
      documents: ['operating_agreement'],
      intakeSchema: oneFieldQuestionnaire as never,
      promptByKind: { operating_agreement: validPrompt('oa') },
    })
    expect(ok.ready).toBe(true)
  })

  it('auto service with no documents cannot draft anything', async () => {
    const { computeCompleteness } = await import('@exsto/legal')
    const c = computeCompleteness({
      serviceKey: 's',
      route: 'auto',
      documents: [],
      intakeSchema: oneFieldQuestionnaire as never,
      promptByKind: {},
    })
    expect(c.ready).toBe(false)
    expect(c.missing.join(' ')).toMatch(/at least one document/i)
  })
})

// ── Full lifecycle on a live DB ─────────────────────────────────────────────
run('service create flow (live DB)', { timeout: 120_000 }, () => {
  const attorneyCtx = { tenantId: TENANT, actorId: ATTORNEY }
  const clientCtx = { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR }
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('manual service: create (disabled) → enable blocked → questionnaire → enable → bookable', async () => {
    const {
      createService,
      serviceCompleteness,
      setServiceActive,
      updateQuestionnaire,
      listServices,
      listServicesIncludingInactive,
      submitBooking,
    } = await import('@exsto/legal')

    const created = await createService(attorneyCtx, {
      displayName: `PR4 Manual ${randomUUID().slice(0, 8)}`,
    })
    const key = created.serviceKey
    // Created disabled + manual + empty questionnaire.
    expect(created.isActive).toBe(false)
    expect(created.route).toBe('manual')

    // Not on the public booking page yet.
    expect((await listServices(attorneyCtx)).some((s) => s.serviceKey === key)).toBe(false)
    // But visible in the admin list (current, inactive).
    expect(
      (await listServicesIncludingInactive(attorneyCtx)).some(
        (s) => s.serviceKey === key && !s.isActive,
      ),
    ).toBe(true)

    // Completeness says: needs a questionnaire.
    const c0 = await serviceCompleteness(attorneyCtx, key)
    expect(c0.ready).toBe(false)
    expect(c0.missing.join(' ')).toMatch(/questionnaire/i)

    // Enabling is GATED — throws naming the missing questionnaire.
    await expect(setServiceActive(attorneyCtx, key, true)).rejects.toThrow(/questionnaire/i)
    // The blocked enable did NOT flip the status (still off the public list).
    expect((await listServices(attorneyCtx)).some((s) => s.serviceKey === key)).toBe(false)

    // Add a questionnaire → now ready (manual route needs nothing else).
    await updateQuestionnaire(attorneyCtx, key, oneFieldQuestionnaire)
    const c1 = await serviceCompleteness(attorneyCtx, key)
    expect(c1.ready).toBe(true)
    expect(c1.missing).toEqual([])

    // Enable succeeds → appears in the PUBLIC active-only list.
    const enabled = await setServiceActive(attorneyCtx, key, true)
    expect(enabled.status).toBe('active')
    expect((await listServices(clientCtx)).some((s) => s.serviceKey === key)).toBe(true)

    // A real client can now book it: the intake→matter→booking chain runs.
    const slot = randomSlot()
    const result = await submitBooking(clientCtx, {
      clientFullName: 'PR4 Client',
      clientEmail: `pr4-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'pr4-test',
      serviceKey: key,
      intakeResponses: { matter_description: 'need an LLC' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    const booked = result.effects[0] as { matterEntityId: string }
    expect(booked.matterEntityId).toBeTruthy()
    const matter = await db.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND akd.kind_name='service_key'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, booked.matterEntityId],
    )
    expect(matter.rows[0]?.value).toBe(key)

    // Tenant-scoping: the new service row exists only for this tenant.
    const cross = await db.query<{ c: string }>(
      `SELECT count(*) AS c FROM workflow_definition WHERE kind_name=$1 AND tenant_id <> $2`,
      [key, TENANT],
    )
    expect(Number(cross.rows[0]!.c)).toBe(0)
  })

  it('auto service: enable also gated on a per-kind drafting prompt', async () => {
    const {
      createService,
      serviceCompleteness,
      setServiceActive,
      updateQuestionnaire,
      updateServiceMetadata,
      updateDraftingPrompt,
      listServices,
    } = await import('@exsto/legal')

    // Create, then make it an auto-route service that drafts two documents.
    const created = await createService(attorneyCtx, {
      displayName: `PR4 Auto ${randomUUID().slice(0, 8)}`,
    })
    const key = created.serviceKey
    await updateServiceMetadata(attorneyCtx, {
      serviceKey: key,
      displayName: created.displayName,
      route: 'auto',
      documents: ['operating_agreement', 'engagement_letter'],
    })

    // Step 1: no questionnaire → blocked on the questionnaire.
    await expect(setServiceActive(attorneyCtx, key, true)).rejects.toThrow(/questionnaire/i)

    // Step 2: add the questionnaire → now blocked on the drafting prompt(s).
    await updateQuestionnaire(attorneyCtx, key, oneFieldQuestionnaire)
    const c1 = await serviceCompleteness(attorneyCtx, key)
    expect(c1.ready).toBe(false)
    expect(c1.missing.join(' ')).toMatch(/prompt/i)
    await expect(setServiceActive(attorneyCtx, key, true)).rejects.toThrow(/prompt/i)

    // Step 3: add a prompt for ONLY the first kind → still blocked on the second.
    await updateDraftingPrompt(attorneyCtx, key, 'operating_agreement', validPrompt('oa'))
    const c2 = await serviceCompleteness(attorneyCtx, key)
    expect(c2.ready).toBe(false)
    expect(c2.missing.join(' ')).toMatch(/engagement_letter/)
    await expect(setServiceActive(attorneyCtx, key, true)).rejects.toThrow(/engagement_letter/)

    // Step 4: add the second prompt → ready, enable succeeds, becomes bookable.
    await updateDraftingPrompt(attorneyCtx, key, 'engagement_letter', validPrompt('el'))
    const c3 = await serviceCompleteness(attorneyCtx, key)
    expect(c3.ready).toBe(true)
    const enabled = await setServiceActive(attorneyCtx, key, true)
    expect(enabled.status).toBe('active')
    expect((await listServices(clientCtx)).some((s) => s.serviceKey === key)).toBe(true)
  })

  it('the completeness MCP tool is attorney-only (not client-callable)', async () => {
    const { isClientPortalTool } = await import('@exsto/legal/mcp')
    expect(isClientPortalTool('legal.service.completeness')).toBe(false)
    // The only service tool the public portal may call stays list (active-only).
    expect(isClientPortalTool('legal.service.list')).toBe(true)
    expect(isClientPortalTool('legal.service.set_active')).toBe(false)
  })
})
