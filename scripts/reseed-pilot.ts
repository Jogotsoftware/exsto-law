// Beta pilot reseed (Objective 12) — THROUGH THE CORE, never raw SQL.
//
// The substrate is append-only: we do not DELETE/TRUNCATE. Instead we ARCHIVE the
// test data (entity.archive action → status='archived', kept as history, dropped
// from active views) and then seed a small, realistic, correctly-parented sample
// on the Client-as-parent model (migration 0020): a handful of clients, each with
// >1 contact and >1 matter, wired via contact_of / matter_of.
//
// Run with the pilot DB url, e.g.:  tsx --env-file=.env.local scripts/reseed-pilot.ts
// Idempotent-ish: archiving is naturally idempotent; seeding is skipped if active
// client entities already exist (so a re-run won't double-seed).
import { closeDbPool, withSuperuser } from '@exsto/shared'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import { submitBooking } from '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR_ID = '00000000-0000-0000-0001-000000000005'
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0001-000000000001'

const publicCtx: ActionContext = { tenantId: TENANT_ID, actorId: PUBLIC_INTAKE_ACTOR_ID }
const systemCtx: ActionContext = { tenantId: TENANT_ID, actorId: SYSTEM_ACTOR_ID }

// App entity kinds whose ACTIVE rows are test data to retire before go-live.
const ARCHIVE_KINDS = [
  'matter',
  'client_contact',
  'call_session',
  'transcript',
  'questionnaire_response',
  'document_draft',
  'deal',
  'person',
  'client',
]

function slotDaysOut(days: number): { startIso: string; endIso: string } {
  const d = new Date()
  d.setDate(d.getDate() + days)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setUTCHours(19, 0, 0, 0) // 15:00 ET
  return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 30 * 60 * 1000).toISOString() }
}

function intake(company: string, address: string, agent: string): Record<string, unknown> {
  return {
    company_name: company,
    company_purpose: 'General business activities permitted under North Carolina law.',
    principal_office_address: address,
    registered_agent_name: agent,
    registered_agent_address: address,
    expected_formation_date: slotDaysOut(14).startIso.slice(0, 10),
  }
}

// 4 pilot clients, each with 2 matters → 2 distinct contacts (so every client has
// >1 contact AND >1 matter, satisfying the Clients-CRM acceptance).
const PILOT = [
  {
    name: 'Acme Holdings LLC',
    rate: '350.00',
    billing: 'hourly' as const,
    address: '120 Fayetteville St, Raleigh, NC 27601',
    matters: [
      { person: 'Marcus Reed', email: 'marcus@acme.pilot', phone: '+1 919 555 0110' },
      { person: 'Dana Holt', email: 'dana@acme.pilot', phone: '+1 919 555 0111' },
    ],
  },
  {
    name: 'Birchwood Ventures LLC',
    rate: '300.00',
    billing: 'hourly' as const,
    address: '88 W Trade St, Charlotte, NC 28202',
    matters: [
      { person: 'Priya Nair', email: 'priya@birchwood.pilot', phone: '+1 704 555 0120' },
      { person: 'Sam Okafor', email: 'sam@birchwood.pilot', phone: '+1 704 555 0121' },
    ],
  },
  {
    name: 'Cedar & Stone Co',
    rate: '5000.00',
    billing: 'fixed' as const,
    address: '14 Biltmore Ave, Asheville, NC 28801',
    matters: [
      { person: 'Lena Cruz', email: 'lena@cedarstone.pilot', phone: '+1 828 555 0130' },
      { person: 'Theo Park', email: 'theo@cedarstone.pilot', phone: '+1 828 555 0131' },
    ],
  },
  {
    name: 'Delphi Robotics Inc',
    rate: '425.00',
    billing: 'hourly' as const,
    address: '300 W Main St, Durham, NC 27701',
    matters: [
      { person: 'Wei Zhang', email: 'wei@delphi.pilot', phone: '+1 984 555 0140' },
      { person: 'Robin Vance', email: 'robin@delphi.pilot', phone: '+1 984 555 0141' },
    ],
  },
]

async function activeIdsOfKind(kind: string): Promise<string[]> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT e.id FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = $2 AND e.status = 'active'`,
      [TENANT_ID, kind],
    )
    return res.rows.map((r) => r.id)
  })
}

// The contact entity behind a matter (client_of: contact → matter).
async function contactForMatter(matterId: string): Promise<string | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT r.source_entity_id AS id FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'client_of'
       LIMIT 1`,
      [TENANT_ID, matterId],
    )
    return res.rows[0]?.id ?? null
  })
}

async function archivePhase(): Promise<number> {
  let archived = 0
  for (const kind of ARCHIVE_KINDS) {
    const ids = await activeIdsOfKind(kind)
    if (ids.length === 0) continue
    process.stdout.write(`  archiving ${ids.length} ${kind}…`)
    for (const id of ids) {
      await archiveEntity(systemCtx, id, 'enforcement')
      archived++
    }
    process.stdout.write(' done\n')
  }
  return archived
}

async function seedPhase(): Promise<number> {
  const existingClients = await activeIdsOfKind('client')
  if (existingClients.length > 0) {
    console.log(`  ↷ ${existingClients.length} active client(s) already present — skipping seed.`)
    return 0
  }
  let created = 0
  let dayOffset = 3
  for (const c of PILOT) {
    const contactIds: string[] = []
    const matterIds: string[] = []
    for (const m of c.matters) {
      const slot = slotDaysOut(dayOffset)
      dayOffset += 2
      const booking = await submitBooking(publicCtx, {
        clientFullName: m.person,
        clientEmail: m.email,
        clientPhone: m.phone,
        clientCompanyName: c.name,
        attributionSource: 'pilot-reseed',
        serviceKey: 'nc_llc_single_member',
        intakeResponses: intake(c.name, c.address, m.person),
        scheduledAtIso: slot.startIso,
        scheduledEndIso: slot.endIso,
      })
      const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
      matterIds.push(matterId)
      const contactId = await contactForMatter(matterId)
      if (contactId) contactIds.push(contactId)
    }
    await submitAction(systemCtx, {
      actionKindName: 'legal.client.create',
      intentKind: 'enforcement',
      payload: {
        client_name: c.name,
        billable_rate: c.rate,
        billing_type: c.billing,
        main_contact_id: contactIds[0] ?? null,
        contact_ids: contactIds,
        matter_ids: matterIds,
      },
    })
    created++
    console.log(`  ✓ ${c.name}: ${contactIds.length} contacts, ${matterIds.length} matters`)
  }
  return created
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (set it in .env.local).')
  console.log('▸ Phase 1: archiving test data through entity.archive…')
  const archived = await archivePhase()
  console.log(`  archived ${archived} entities.\n`)
  console.log('▸ Phase 2: seeding the pilot sample (Client-as-parent) through the core…')
  const created = await seedPhase()
  console.log(`\n✓ Reseed complete: archived ${archived}, created ${created} clients.`)
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('✗ Reseed failed:', error)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
