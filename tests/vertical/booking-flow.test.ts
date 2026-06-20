// WP2 vertical acceptance: the intake → matter.open → booking.create chain on a
// live DB (binding Lesson #5/#8 — executable tests, done = a database query).
// DB-gated like tests/invariants: skips (not fails) when no DB URL is wired.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'

// A far-future weekday slot randomized per run so reruns never collide with
// earlier test bookings (test data persists on the dev DB).
function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 60 + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

// Live round-trips over the session pooler are slow; give each test headroom.
run('booking flow (live DB)', { timeout: 60_000 }, () => {
  const ctx = { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR }
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('intake.submit → matter.open → booking.create writes the full audited chain', async () => {
    const { submitBooking } = await import('@exsto/legal')
    const slot = randomSlot()
    const email = `wp2-test-${randomUUID().slice(0, 8)}@example.test`

    const result = await submitBooking(ctx, {
      clientFullName: 'WP2 Test Prospect',
      clientEmail: email,
      clientPhone: '+1 919 555 0100',
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_single_member',
      intakeResponses: { company_name: 'WP2 Test LLC', company_purpose: 'testing' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    expect(result.actionId).toBeTruthy()
    const booked = result.effects[0] as { matterEntityId: string }
    expect(booked.matterEntityId).toBeTruthy()
    const matterId = booked.matterEntityId

    // Matter entity carries scheduling metadata for the slot guard.
    const matter = await db.query(`SELECT metadata FROM entity WHERE tenant_id=$1 AND id=$2`, [
      TENANT,
      matterId,
    ])
    expect(matter.rows[0].metadata.scheduled_at).toBe(slot.startIso)

    // Three audited actions, one per vocabulary step.
    const actions = await db.query<{ kind_name: string }>(
      `SELECT akd.kind_name FROM action a
       JOIN action_kind_definition akd ON akd.id = a.action_kind_id
       WHERE a.tenant_id=$1
         AND (a.payload->>'matter_entity_id' = $2 OR a.payload->>'client_email' = $3)
       ORDER BY a.recorded_at`,
      [TENANT, matterId, email],
    )
    expect(actions.rows.map((r) => r.kind_name)).toEqual([
      'intake.submit',
      'matter.open',
      'booking.create',
    ])

    // Provenanced attributes on the matter, including governing law (REQ-DRAFT-04).
    const attrs = await db.query<{ kind_name: string; value: unknown }>(
      `SELECT akd.kind_name, a.value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2`,
      [TENANT, matterId],
    )
    const byKind = new Map(attrs.rows.map((r) => [r.kind_name, r.value]))
    expect(byKind.get('service_key')).toBe('nc_llc_single_member')
    expect(byKind.get('workflow_route')).toBe('auto')
    expect(byKind.get('governing_law')).toBe('North Carolina')
    expect(byKind.has('scheduled_at')).toBe(true)

    // Relationships: client_of + response_of point at the matter.
    const rels = await db.query<{ kind_name: string }>(
      `SELECT rkd.kind_name FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id=$1 AND r.target_entity_id=$2`,
      [TENANT, matterId],
    )
    const relKinds = rels.rows.map((r) => r.kind_name).sort()
    expect(relKinds).toContain('client_of')
    expect(relKinds).toContain('response_of')

    // Lifecycle events. Exclude draft.* — auto-route services (this one) draft at
    // submit, so enqueueAutoDrafts emits draft.requested (and later draft.completed)
    // against the matter; those are the auto-draft feature's concern, covered by its
    // own tests. Here we pin the booking lifecycle chain only.
    const events = await db.query<{ kind_name: string }>(
      `SELECT ekd.kind_name FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id=$1 AND e.primary_entity_id=$2
         AND ekd.kind_name NOT LIKE 'draft.%'
       ORDER BY e.recorded_at`,
      [TENANT, matterId],
    )
    expect(events.rows.map((r) => r.kind_name)).toEqual(['matter.opened', 'consultation.booked'])
  })

  it('rejects a double-booked slot with SLOT_TAKEN', async () => {
    const { submitBooking } = await import('@exsto/legal')
    const slot = randomSlot()
    const mk = (n: number) => ({
      clientFullName: `WP2 Race ${n}`,
      clientEmail: `wp2-race-${n}-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey: 'something_else',
      intakeResponses: { matter_description: 'race test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    await submitBooking(ctx, mk(1))
    await expect(submitBooking(ctx, mk(2))).rejects.toThrow(/SLOT_TAKEN/)
  })

  // Booking stamps the service's route onto the matter. nc_llc_multi_member is now
  // auto (vertical migration 0013); 'something_else' is the catch-all that stays
  // manual. Both directions are exercised so the route-wiring is covered either way.
  it('multi-member booking stamps the auto route onto the matter', async () => {
    const { submitBooking } = await import('@exsto/legal')
    const slot = randomSlot()
    const result = await submitBooking(ctx, {
      clientFullName: 'WP2 Multi Member',
      clientEmail: `wp2-mm-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey: 'nc_llc_multi_member',
      intakeResponses: { company_name: 'MM Test LLC', member_count: '3' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    const booked = result.effects[0] as { matterEntityId: string }
    const route = await db.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND akd.kind_name='workflow_route'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, booked.matterEntityId],
    )
    expect(route.rows[0].value).toBe('auto')
  })

  it('catch-all (something_else) booking stamps the manual route onto the matter', async () => {
    const { submitBooking } = await import('@exsto/legal')
    const slot = randomSlot()
    const result = await submitBooking(ctx, {
      clientFullName: 'WP2 Catch All',
      clientEmail: `wp2-ce-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'vertical-test',
      serviceKey: 'something_else',
      intakeResponses: { matter_description: 'general consult' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    })
    const booked = result.effects[0] as { matterEntityId: string }
    const route = await db.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND akd.kind_name='workflow_route'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, booked.matterEntityId],
    )
    expect(route.rows[0].value).toBe('manual')
  })
})
