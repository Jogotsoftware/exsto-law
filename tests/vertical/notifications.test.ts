// WP6 vertical acceptance: notification routing on a live DB. Email DELIVERY
// requires the attorney's Google connection (Settings → Connect Google), so
// live-send receipts are demo-time; this verifies the substrate truth: route
// configuration as data, queue wiring per workflow route, and loud failures
// (no silent drops).
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'

function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 1300 + Math.floor(Math.random() * 200)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(18, Math.random() < 0.5 ? 0 : 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

async function bookAndGetNotifyJobs(
  db: pg.Pool,
  serviceKey: string,
): Promise<{ routes: string[]; clientEmail: string }> {
  const { submitBooking } = await import('@exsto/legal')
  const clientEmail = `wp6-${randomUUID().slice(0, 8)}@example.test`
  const slot = randomSlot()
  await submitBooking(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      clientFullName: 'WP6 Notify Client',
      clientEmail,
      attributionSource: 'vertical-test',
      serviceKey,
      intakeResponses: { company_name: 'WP6 LLC', matter_description: 'notify test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    },
  )
  const jobs = await db.query<{ payload: { route: string; to: string | null } }>(
    `SELECT payload FROM worker_job
     WHERE tenant_id = $1 AND job_kind = 'legal.notify'
       AND (payload->>'to' = $2 OR payload->'variables'->>'client_email' = $2)`,
    [TENANT, clientEmail],
  )
  return { routes: jobs.rows.map((r) => r.payload.route).sort(), clientEmail }
}

run('notifications (live DB)', { timeout: 90_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('routes exist as configuration data with email channel and no sms', async () => {
    const routes = await db.query<{ kind_name: string; channel: string }>(
      `SELECT kind_name, channel FROM notification_route_definition
       WHERE tenant_id = $1 AND status='active' ORDER BY kind_name`,
      [TENANT],
    )
    expect(routes.rows.map((r) => r.kind_name)).toEqual([
      'attorney_draft_completed',
      'attorney_manual_matter',
      'prospect_booking_confirmation',
      'prospect_intake_confirmation',
    ])
    expect(routes.rows.every((r) => r.channel === 'email')).toBe(true)
  })

  it('manual-workflow booking queues attorney safety-net email + both prospect confirmations', async () => {
    const { routes } = await bookAndGetNotifyJobs(db, 'nc_llc_multi_member')
    expect(routes).toEqual([
      'attorney_manual_matter',
      'prospect_booking_confirmation',
      'prospect_intake_confirmation',
    ])
  })

  it('auto-route booking queues prospect confirmations only (calendar event is the attorney notification)', async () => {
    const { routes } = await bookAndGetNotifyJobs(db, 'nc_llc_single_member')
    expect(routes).toEqual(['prospect_booking_confirmation', 'prospect_intake_confirmation'])
  })

  it('delivery fails loudly on unknown routes and missing channel prerequisites', async () => {
    const { deliverNotification, ingestionContext } = await import('@exsto/legal')
    await expect(
      deliverNotification(ingestionContext(), {
        routeKindName: 'nonexistent_route',
        to: 'x@example.test',
        variables: {},
      }),
    ).rejects.toThrow(/route not found/i)
    // Email driver without a Google connection throws (job retries; never a
    // silent drop).
    await expect(
      deliverNotification(ingestionContext(), {
        routeKindName: 'prospect_intake_confirmation',
        to: 'x@example.test',
        variables: {},
      }),
    ).rejects.toThrow(/Google|connect/i)
  })
})
