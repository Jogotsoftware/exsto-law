// WP3 vertical acceptance: Granola ingestion pipeline on a live DB —
// matching, projection via call.ingest, replay idempotency, unmatched review
// queue, webhook signature verification. DB-gated like tests/invariants.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'

function randomSlot(): { startIso: string; endIso: string } {
  const daysAhead = 400 + Math.floor(Math.random() * 300)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(15, Math.random() < 0.5 ? 0 : 30, 0, 0)
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

run('granola ingestion (live DB)', { timeout: 60_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('matches a booked matter by attendee email + time window and projects the call', async () => {
    const { submitBooking, projectGranolaCall, ingestionContext } = await import('@exsto/legal')
    const slot = randomSlot()
    const email = `wp3-${randomUUID().slice(0, 8)}@example.test`

    const booking = await submitBooking(
      { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
      {
        clientFullName: 'WP3 Granola Client',
        clientEmail: email,
        attributionSource: 'vertical-test',
        serviceKey: 'nc_llc_single_member',
        intakeResponses: { company_name: 'WP3 Ingest LLC' },
        scheduledAtIso: slot.startIso,
        scheduledEndIso: slot.endIso,
      },
    )
    const matterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId

    const callId = `wp3-call-${randomUUID().slice(0, 8)}`
    const result = await projectGranolaCall(
      ingestionContext(),
      {
        callId,
        startedAt: slot.startIso,
        endedAt: slot.endIso,
        durationSeconds: 1800,
        attendeeEmails: [email.toUpperCase()], // case-insensitive match
        transcriptText: 'Attorney: hello. Client: hello. We discussed the LLC formation.',
        notes: { summary: 'Discussed single-member LLC formation.' },
      },
      { source: 'granola' },
    )
    const effects = result.effects[0] as { matched: boolean; callEntityId: string }
    expect(effects.matched).toBe(true)

    // call_of relationship lands on the booked matter.
    const rel = await db.query(
      `SELECT 1 FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id=$1 AND rkd.kind_name='call_of'
         AND r.source_entity_id=$2 AND r.target_entity_id=$3`,
      [TENANT, effects.callEntityId, matterId],
    )
    expect(rel.rowCount).toBe(1)

    // matter status advanced to consulted; transcript.received event recorded.
    const status = await db.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id=$1 AND a.entity_id=$2 AND akd.kind_name='matter_status'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [TENANT, matterId],
    )
    expect(status.rows[0].value).toBe('consulted')

    const evt = await db.query(
      `SELECT 1 FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id=$1 AND e.primary_entity_id=$2 AND ekd.kind_name='transcript.received'`,
      [TENANT, matterId],
    )
    expect(evt.rowCount).toBe(1)
  })

  it('replaying the same call id creates no duplicates', async () => {
    const { projectGranolaCall, ingestionContext } = await import('@exsto/legal')
    const callId = `wp3-replay-${randomUUID().slice(0, 8)}`
    const data = {
      callId,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 60,
      attendeeEmails: [],
      transcriptText: 'replay test transcript',
      notes: null,
    }
    const first = await projectGranolaCall(ingestionContext(), data, { source: 'granola' })
    const second = await projectGranolaCall(ingestionContext(), data, { source: 'granola' })
    expect((first.effects[0] as { deduplicated: boolean }).deduplicated).toBe(false)
    expect((second.effects[0] as { deduplicated: boolean }).deduplicated).toBe(true)

    const count = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id=$1 AND akd.kind_name='granola_call_id' AND a.value #>> '{}' = $2`,
      [TENANT, callId],
    )
    expect(Number(count.rows[0].n)).toBe(1)
  })

  it('an unmatched transcript lands in the review queue, never the void', async () => {
    const { projectGranolaCall, ingestionContext } = await import('@exsto/legal')
    const callId = `wp3-unmatched-${randomUUID().slice(0, 8)}`
    const result = await projectGranolaCall(
      ingestionContext(),
      {
        callId,
        startedAt: new Date().toISOString(),
        endedAt: null,
        durationSeconds: null,
        attendeeEmails: ['nobody-we-know@example.test'],
        transcriptText: 'unmatched call transcript',
        notes: null,
      },
      { source: 'granola' },
    )
    const effects = result.effects[0] as { matched: boolean; callEntityId: string }
    expect(effects.matched).toBe(false)

    // Review queue = call_sessions with no call_of relationship.
    const queue = await db.query(
      `SELECT e.id FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id=$1 AND ekd.kind_name='call_session' AND e.status='active'
         AND NOT EXISTS (
           SELECT 1 FROM relationship r
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
           WHERE r.tenant_id = e.tenant_id AND r.source_entity_id = e.id
             AND rkd.kind_name='call_of'
         )
         AND e.id = $2`,
      [TENANT, effects.callEntityId],
    )
    expect(queue.rowCount).toBe(1)
  })

  it('verifies webhook HMAC signatures (constant-time)', async () => {
    const { verifyGranolaSignature } =
      await import('../../verticals/legal/dist/adapters/granola.js')
    const secret = 'test-webhook-secret'
    const body = JSON.stringify({ call_id: 'sig-test', transcript: 'hi' })
    const good = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifyGranolaSignature(body, `sha256=${good}`, secret)).toBe(true)
    expect(verifyGranolaSignature(body, good, secret)).toBe(true)
    expect(verifyGranolaSignature(body, 'sha256=' + '0'.repeat(64), secret)).toBe(false)
    expect(verifyGranolaSignature(body, null, secret)).toBe(false)
  })
})
