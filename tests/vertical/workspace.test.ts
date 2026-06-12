// WP7 vertical acceptance: calendar management actions + mail projection on a
// live DB. Google round-trips need the attorney's connected account (demo-time
// receipt); this verifies the substrate truth: booking.update/cancel chains,
// mail.ingest idempotency on Gmail ids, matter-scoped communication history,
// and client-mail-only refusals.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'

function randomSlot(offsetDays = 1600): { startIso: string; endIso: string } {
  const daysAhead = offsetDays + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 1800e3).toISOString() }
}

async function makeMatter(): Promise<{ matterId: string; email: string }> {
  const { submitBooking } = await import('@exsto/legal')
  const email = `wp7-${randomUUID().slice(0, 8)}@example.test`
  const slot = randomSlot()
  const booking = await submitBooking(
    { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
    {
      clientFullName: 'WP7 Workspace Client',
      clientEmail: email,
      attributionSource: 'vertical-test',
      serviceKey: 'something_else',
      intakeResponses: { matter_description: 'workspace test' },
      scheduledAtIso: slot.startIso,
      scheduledEndIso: slot.endIso,
    },
  )
  return { matterId: (booking.effects[0] as { matterEntityId: string }).matterEntityId, email }
}

run('calendar & mail workspace (live DB)', { timeout: 120_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('reschedule + cancel run through booking.update/cancel with events and metadata', async () => {
    const { rescheduleBooking, cancelBooking } = await import('@exsto/legal')
    const ctx = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }
    const { matterId } = await makeMatter()
    const newSlot = randomSlot(1900)

    await rescheduleBooking(ctx, {
      matterEntityId: matterId,
      startIso: newSlot.startIso,
      endIso: newSlot.endIso,
    })
    const afterReschedule = await db.query<{ metadata: { scheduled_at: string } }>(
      `SELECT metadata FROM entity WHERE tenant_id=$1 AND id=$2`,
      [TENANT, matterId],
    )
    expect(afterReschedule.rows[0].metadata.scheduled_at).toBe(newSlot.startIso)

    await cancelBooking(ctx, { matterEntityId: matterId, reason: 'test cancel' })
    const afterCancel = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM entity WHERE tenant_id=$1 AND id=$2`,
      [TENANT, matterId],
    )
    expect(afterCancel.rows[0].metadata.scheduled_at).toBeUndefined()

    const events = await db.query<{ kind_name: string }>(
      `SELECT ekd.kind_name FROM event e
       JOIN event_kind_definition ekd ON ekd.id=e.event_kind_id
       WHERE e.tenant_id=$1 AND e.primary_entity_id=$2 ORDER BY e.recorded_at`,
      [TENANT, matterId],
    )
    expect(events.rows.map((r) => r.kind_name)).toEqual(
      expect.arrayContaining(['consultation.rescheduled', 'consultation.cancelled']),
    )
  })

  it('mail.ingest is idempotent on Gmail ids and lands matter-scoped history', async () => {
    const { submitAction } = await import('@exsto/substrate')
    const { matterCommunications } = await import('@exsto/legal')
    const ctx = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }
    const { matterId, email } = await makeMatter()
    const gmailThreadId = `wp7-thread-${randomUUID().slice(0, 8)}`

    const payload = {
      gmail_thread_id: gmailThreadId,
      subject: 'Operating agreement questions',
      participant_emails: [email, 'jcp@pacheco.law'],
      matter_entity_id: matterId,
      messages: [
        {
          gmail_message_id: `${gmailThreadId}-m1`,
          from: email,
          to: 'jcp@pacheco.law',
          sent_at: new Date().toISOString(),
          body_text: 'Hi Juan Carlos, two questions about the draft…',
        },
        {
          gmail_message_id: `${gmailThreadId}-m2`,
          from: 'jcp@pacheco.law',
          to: email,
          sent_at: new Date().toISOString(),
          body_text: 'Happy to clarify — see below.',
        },
      ],
    }
    const first = await submitAction(ctx, {
      actionKindName: 'mail.ingest',
      intentKind: 'automatic_sync',
      payload,
    })
    expect((first.effects[0] as { inserted: number }).inserted).toBe(2)

    // Replay: same thread + messages → zero new rows.
    const second = await submitAction(ctx, {
      actionKindName: 'mail.ingest',
      intentKind: 'automatic_sync',
      payload,
    })
    expect((second.effects[0] as { inserted: number }).inserted).toBe(0)

    const threadCount = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM communication_thread
       WHERE tenant_id=$1 AND participants->>'gmail_thread_id'=$2`,
      [TENANT, gmailThreadId],
    )
    expect(Number(threadCount.rows[0].n)).toBe(1)

    // Matter-scoped history surfaces it.
    const comms = await matterCommunications(ctx, matterId)
    expect(comms.length).toBe(1)
    expect(comms[0].subject).toBe('Operating agreement questions')
    expect(comms[0].messageCount).toBe(2)
  })

  it('mail.send records the outbound message with gmail provenance', async () => {
    const { submitAction } = await import('@exsto/substrate')
    const ctx = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }
    const { matterId, email } = await makeMatter()
    const messageId = `wp7-out-${randomUUID().slice(0, 8)}`

    await submitAction(ctx, {
      actionKindName: 'mail.send',
      intentKind: 'enforcement',
      payload: {
        gmail_thread_id: null,
        gmail_message_id: messageId,
        subject: 'Your draft is ready',
        to: email,
        from: 'jcp@pacheco.law',
        body_text: 'Please review the attached draft.',
        matter_entity_id: matterId,
      },
    })

    const msg = await db.query<{ source_ref: string; payload: { direction: string } }>(
      `SELECT source_ref, payload FROM communication_message
       WHERE tenant_id=$1 AND payload->>'gmail_message_id'=$2`,
      [TENANT, messageId],
    )
    expect(msg.rowCount).toBe(1)
    expect(msg.rows[0].source_ref).toBe('integration:gmail')
    expect(msg.rows[0].payload.direction).toBe('outbound')
  })

  it('compose refuses non-client addresses (client-mail-only discipline)', async () => {
    const { composeToClient } = await import('@exsto/legal')
    const ctx = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }
    await expect(
      composeToClient(ctx, {
        to: `stranger-${randomUUID().slice(0, 6)}@example.test`,
        subject: 'should not send',
        bodyText: 'nope',
      }),
    ).rejects.toThrow(/not a known client/)
  })
})
