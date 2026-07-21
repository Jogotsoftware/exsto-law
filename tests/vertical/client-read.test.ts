// Clients CRM read API (beta sprint Obj 2/3). On a fresh DB, after creating a
// client that groups two contacts + two matters, listClients reports the counts
// + settings and getClient returns the attached contacts and matters with the
// main contact flagged. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { submitBooking, listClients, getClient } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { withSuperuser, closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const publicCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

function slot(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setUTCHours(19, 0, 0, 0)
  return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 30 * 60 * 1000).toISOString() }
}

async function bookMatter(person: string, email: string, days: number): Promise<string> {
  const s = slot(days)
  const b = await submitBooking(publicCtx, {
    clientFullName: person,
    clientEmail: email,
    clientPhone: '+1 919 555 0001',
    clientCompanyName: 'Read Test Co',
    attributionSource: 'client-read-test',
    serviceKey: 'nc_llc_single_member',
    intakeResponses: { company_name: 'Read Test Co' },
    scheduledAtIso: s.startIso,
    scheduledEndIso: s.endIso,
  })
  return (b.effects[0] as { matterEntityId: string }).matterEntityId
}

async function contactFor(matterId: string): Promise<string> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT r.source_entity_id AS id FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'client_of' LIMIT 1`,
      [TENANT, matterId],
    )
    return r.rows[0]!.id
  })
}

run('Clients CRM read API (live DB)', { timeout: 120_000 }, () => {
  const tag = `crd-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('listClients + getClient surface the parent grouping and settings', async () => {
    const m1 = await bookMatter(`${tag} Ann`, `${tag}-ann@read.test`, 4)
    const m2 = await bookMatter(`${tag} Ben`, `${tag}-ben@read.test`, 6)
    const c1 = await contactFor(m1)
    const c2 = await contactFor(m2)

    const created = await submitAction(attorneyCtx, {
      actionKindName: 'legal.client.create',
      intentKind: 'enforcement',
      payload: {
        client_name: `${tag} ReadCo`,
        billable_rate: '275.00',
        billing_type: 'hourly',
        main_contact_id: c1,
        contact_ids: [c1, c2],
        matter_ids: [m1, m2],
      },
    })
    const clientId = (created.effects[0] as { clientEntityId: string }).clientEntityId

    // listClients reports counts + settings.
    const list = await listClients(attorneyCtx)
    const mine = list.find((c) => c.clientEntityId === clientId)
    expect(mine).toBeTruthy()
    expect(mine?.name).toBe(`${tag} ReadCo`)
    expect(mine?.billableRate).toBe('275.00')
    expect(mine?.billingType).toBe('hourly')
    expect(mine?.contactCount).toBe(2)
    expect(mine?.matterCount).toBe(2)

    // getClient returns the attached contacts (main flagged) + matters.
    const detail = await getClient(attorneyCtx, clientId)
    expect(detail?.contacts.map((c) => c.contactEntityId).sort()).toEqual([c1, c2].sort())
    expect(detail?.contacts.find((c) => c.contactEntityId === c1)?.isMain).toBe(true)
    expect(detail?.contacts.find((c) => c.contactEntityId === c2)?.isMain).toBe(false)
    expect(detail?.matters.map((m) => m.matterEntityId).sort()).toEqual([m1, m2].sort())
    expect(detail?.matters.every((m) => m.serviceKey === 'nc_llc_single_member')).toBe(true)
  })

  it('listClients and getClient agree on matter count after a matter is archived', async () => {
    const t = `${tag}-arch`
    const m1 = await bookMatter(`${t} Cy`, `${t}-cy@read.test`, 4)
    const m2 = await bookMatter(`${t} Di`, `${t}-di@read.test`, 6)
    const c1 = await contactFor(m1)
    const c2 = await contactFor(m2)

    const created = await submitAction(attorneyCtx, {
      actionKindName: 'legal.client.create',
      intentKind: 'enforcement',
      payload: {
        client_name: `${t} ArchCo`,
        billable_rate: '300.00',
        billing_type: 'hourly',
        main_contact_id: c1,
        contact_ids: [c1, c2],
        matter_ids: [m1, m2],
      },
    })
    const clientId = (created.effects[0] as { clientEntityId: string }).clientEntityId

    // Both matters active: list and detail agree at 2.
    const before = (await listClients(attorneyCtx)).find((c) => c.clientEntityId === clientId)
    expect(before?.matterCount).toBe(2)
    expect((await getClient(attorneyCtx, clientId))?.matterCount).toBe(2)

    // Archive one matter through the core action (status → 'archived'; the
    // matter_of relationship stays open). listClients used to count the open
    // relationship without checking the matter entity's status, so it kept
    // reporting 2 while getClient (active-only) reported 1. Assert parity.
    await submitAction(attorneyCtx, {
      actionKindName: 'entity.archive',
      intentKind: 'enforcement',
      payload: { entity_id: m2 },
    })

    const listAfter = (await listClients(attorneyCtx)).find((c) => c.clientEntityId === clientId)
    const detailAfter = await getClient(attorneyCtx, clientId)
    expect(listAfter?.matterCount).toBe(1)
    expect(detailAfter?.matterCount).toBe(1)
    expect(detailAfter?.matters.map((m) => m.matterEntityId)).toEqual([m1])
  })
})
