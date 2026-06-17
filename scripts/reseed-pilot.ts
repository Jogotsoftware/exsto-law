// Beta pilot reseed (Objective 12) — THROUGH THE CORE, never raw SQL.
//
// The substrate is append-only: we do not DELETE/TRUNCATE. Instead we ARCHIVE the
// test data (entity.archive action → status='archived', kept as history, dropped
// from active views) and then seed a small, realistic, correctly-parented sample
// on the Client-as-parent model (migration 0020): a handful of clients, each with
// >1 contact and >1 matter, wired via contact_of / matter_of.
//
// SIDE-EFFECT-FREE: matters are created with the low-level intake.submit +
// matter.open actions (pure substrate writes) — NOT submitBooking, which also
// creates a Google Calendar event and queues confirmation emails. The reseed must
// never send mail or touch Google for fake pilot contacts.
//
// Run with the pilot DB url:  tsx --env-file=.env.local scripts/reseed-pilot.ts
// Idempotent-ish: archiving is naturally idempotent; seeding is skipped if active
// client entities already exist (so a re-run won't double-seed).
import { randomUUID } from 'node:crypto'
import { closeDbPool, withSuperuser } from '@exsto/shared'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR_ID = '00000000-0000-0000-0001-000000000005'
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0001-000000000001'
const SERVICE = 'nc_llc_single_member'

const publicCtx: ActionContext = { tenantId: TENANT_ID, actorId: PUBLIC_INTAKE_ACTOR_ID }
const systemCtx: ActionContext = { tenantId: TENANT_ID, actorId: SYSTEM_ACTOR_ID }

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

function intakeResponses(company: string, address: string, agent: string): Record<string, unknown> {
  return {
    company_name: company,
    company_purpose: 'General business activities permitted under North Carolina law.',
    principal_office_address: address,
    registered_agent_name: agent,
    registered_agent_address: address,
  }
}

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

let matterSeq = 0

// Create one contact + matter through the core (no booking, no Google, no email).
async function createContactMatter(
  client: (typeof PILOT)[number],
  m: (typeof PILOT)[number]['matters'][number],
): Promise<{ matterId: string; contactId: string }> {
  const intake = await submitAction(publicCtx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: m.person,
      client_email: m.email,
      client_phone: m.phone,
      client_company_name: client.name,
      service_key: SERVICE,
      intake_form_id: null,
      intake_responses: intakeResponses(client.name, client.address, m.person),
    },
  })
  const eff = intake.effects[0] as { clientEntityId: string; questionnaireEntityId: string }
  const matterId = randomUUID()
  await submitAction(publicCtx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterId,
      matter_number: `M-PILOT-${String(++matterSeq).padStart(3, '0')}`,
      service_key: SERVICE,
      workflow_route: 'auto',
      attribution_source: 'pilot-reseed',
      client_entity_id: eff.clientEntityId,
      questionnaire_entity_id: eff.questionnaireEntityId,
      intake_action_id: intake.actionId,
    },
  })
  return { matterId, contactId: eff.clientEntityId }
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
  for (const c of PILOT) {
    const contactIds: string[] = []
    const matterIds: string[] = []
    for (const m of c.matters) {
      const { matterId, contactId } = await createContactMatter(c, m)
      matterIds.push(matterId)
      contactIds.push(contactId)
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
