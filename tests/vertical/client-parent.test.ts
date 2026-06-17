// Beta sprint Objective 1 — Client as the parent entity. On a fresh DB (with
// migration 0020), a client created through legal.client.create groups its
// contacts + matters via contact_of / matter_of, and carries its settings
// (billable rate as a decimal string, billing type, main contact). legal.client
// .update changes a setting (append-only: a new attribute supersedes). DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { submitBooking } from '@exsto/legal'
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

async function latestAttr(entityId: string, kind: string): Promise<string | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ v: string | null }>(
      `SELECT a.value #>> '{}' AS v
       FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = $3
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, entityId, kind],
    )
    return res.rows[0]?.v ?? null
  })
}

async function relExists(sourceId: string, targetId: string, kind: string): Promise<boolean> {
  return withSuperuser(async (client) => {
    const res = await client.query(
      `SELECT 1 FROM relationship r JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND r.target_entity_id = $3
         AND rkd.kind_name = $4 AND (r.valid_to IS NULL OR r.valid_to > now())`,
      [TENANT, sourceId, targetId, kind],
    )
    return (res.rowCount ?? 0) > 0
  })
}

async function bookMatter(person: string, email: string, days: number): Promise<string> {
  const s = slot(days)
  const booking = await submitBooking(publicCtx, {
    clientFullName: person,
    clientEmail: email,
    clientPhone: '+1 919 555 0000',
    clientCompanyName: 'Test Parent Co',
    attributionSource: 'client-parent-test',
    serviceKey: 'nc_llc_single_member',
    intakeResponses: { company_name: 'Test Parent Co', principal_office_address: '1 Main St' },
    scheduledAtIso: s.startIso,
    scheduledEndIso: s.endIso,
  })
  return (booking.effects[0] as { matterEntityId: string }).matterEntityId
}

async function contactForMatter(matterId: string): Promise<string> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT r.source_entity_id AS id FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'client_of' LIMIT 1`,
      [TENANT, matterId],
    )
    return res.rows[0]!.id
  })
}

run('Client-as-parent (live DB)', { timeout: 120_000 }, () => {
  const tag = `cpt-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('groups >1 contact and >1 matter under a client, with settings persisted', async () => {
    // Two matters → two distinct contacts.
    const m1 = await bookMatter(`${tag} Alice`, `${tag}-alice@pilot.test`, 4)
    const m2 = await bookMatter(`${tag} Bob`, `${tag}-bob@pilot.test`, 6)
    const c1 = await contactForMatter(m1)
    const c2 = await contactForMatter(m2)
    expect(c1).not.toBe(c2)

    const res = await submitAction(attorneyCtx, {
      actionKindName: 'legal.client.create',
      intentKind: 'enforcement',
      payload: {
        client_name: `${tag} Parent`,
        billable_rate: '350.00',
        billing_type: 'hourly',
        main_contact_id: c1,
        contact_ids: [c1, c2],
        matter_ids: [m1, m2],
      },
    })
    const clientId = (res.effects[0] as { clientEntityId: string }).clientEntityId
    expect(clientId).toMatch(/^[0-9a-f-]{36}$/i)

    // Settings persisted (rate is a decimal string).
    expect(await latestAttr(clientId, 'client_name')).toBe(`${tag} Parent`)
    expect(await latestAttr(clientId, 'client_billable_rate')).toBe('350.00')
    expect(await latestAttr(clientId, 'client_billing_type')).toBe('hourly')
    expect(await latestAttr(clientId, 'client_main_contact')).toBe(c1)

    // Both contacts and both matters are parented under the client (zero orphans).
    expect(await relExists(c1, clientId, 'contact_of')).toBe(true)
    expect(await relExists(c2, clientId, 'contact_of')).toBe(true)
    expect(await relExists(m1, clientId, 'matter_of')).toBe(true)
    expect(await relExists(m2, clientId, 'matter_of')).toBe(true)

    // legal.client.update supersedes a setting (append-only new attribute value).
    await submitAction(attorneyCtx, {
      actionKindName: 'legal.client.update',
      intentKind: 'adjustment',
      payload: { client_entity_id: clientId, billable_rate: '400.00', billing_type: 'fixed' },
    })
    expect(await latestAttr(clientId, 'client_billable_rate')).toBe('400.00')
    expect(await latestAttr(clientId, 'client_billing_type')).toBe('fixed')
  })
})
