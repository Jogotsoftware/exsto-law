// Client Portal PR2 — two-way client↔attorney messaging on the core append-only
// communication tables (communication_thread + communication_message).
//
// Properties under test (DB-gated; create real client+matter via submitBooking
// like client-portal-auth.test.ts, so these skip — not fail — without a DB URL):
//   • PROVENANCE (the PR2 model): a client post sets sender_entity_id (the
//     client_contact) and NULL sender_actor_id; an attorney post sets
//     sender_actor_id and NULL sender_entity_id; payload.author distinguishes.
//   • ONE THREAD per matter: both posts land in the same portal thread.
//   • SCOPED: getMatterThread for a different matter returns [] (no leak); via
//     the authed route, client A's cookie gets a 404 (no oracle) for matter B.
//   • APPEND-ONLY: an UPDATE/DELETE on communication_message is rejected (RLS
//     cm_no_update / cm_no_delete).
//   • NOTIFICATION on each post: a legal.notify job is queued, and the email
//     payload carries NO message body (links only).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const SECRET = 'test-session-secret-32-bytes-minimum!!'
const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
// A real, active human attorney actor seeded by the core foundation (Juan
// Carlos). Used as the attorney ctx so the attorney message's sender_actor_id
// references a valid actor row.
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const dbRun = describe.skipIf(!url)

function withSecret() {
  const prior = process.env.OAUTH_STATE_SECRET
  process.env.OAUTH_STATE_SECRET = SECRET
  return () => {
    if (prior === undefined) delete process.env.OAUTH_STATE_SECRET
    else process.env.OAUTH_STATE_SECRET = prior
  }
}

function farFutureSlot() {
  const daysAhead = 60 + Math.floor(Math.random() * 200000)
  const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
  start.setUTCHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 2) * 30, 0, 0)
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

dbRun('client portal messaging (live DB)', { timeout: 120_000 }, () => {
  let restore: () => void
  const db = new pg.Pool({ connectionString: url })
  const clientCtx = { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR }
  const attorneyCtx = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }

  let clientAContactId = ''
  let matterAId = ''
  let matterBId = ''
  let clientAEmail = ''

  beforeAll(async () => {
    restore = withSecret()
    const { submitBooking, findClientContactByEmail } = await import('@exsto/legal')

    clientAEmail = `msg-a-${randomUUID().slice(0, 8)}@example.test`
    const slotA = farFutureSlot()
    const resA = await submitBooking(clientCtx, {
      clientFullName: 'Msg Client A',
      clientEmail: clientAEmail,
      attributionSource: 'client-messaging-test',
      serviceKey: 'something_else',
      intakeResponses: { matter_description: 'msg A' },
      scheduledAtIso: slotA.startIso,
      scheduledEndIso: slotA.endIso,
    })
    matterAId = (resA.effects[0] as { matterEntityId: string }).matterEntityId

    const slotB = farFutureSlot()
    const resB = await submitBooking(clientCtx, {
      clientFullName: 'Msg Client B',
      clientEmail: `msg-b-${randomUUID().slice(0, 8)}@example.test`,
      attributionSource: 'client-messaging-test',
      serviceKey: 'something_else',
      intakeResponses: { matter_description: 'msg B' },
      scheduledAtIso: slotB.startIso,
      scheduledEndIso: slotB.endIso,
    })
    matterBId = (resB.effects[0] as { matterEntityId: string }).matterEntityId

    const contact = await findClientContactByEmail(clientAEmail)
    clientAContactId = contact!.clientContactId
    // Two bookings + a cold vertical import exceed vitest's default 10s HOOK
    // timeout (separate from the per-test timeout above); raise it explicitly.
  }, 120_000)

  afterAll(async () => {
    restore()
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('client post → sender_entity_id (the client_contact), NULL actor, payload.author=client', async () => {
    const { postClientMessage } = await import('@exsto/legal')
    await postClientMessage(clientCtx, {
      matterEntityId: matterAId,
      body: 'Hello from the client.',
      clientContactId: clientAContactId,
    })

    const rows = await db.query<{
      sender_actor_id: string | null
      sender_entity_id: string | null
      author: string | null
      body: string | null
    }>(
      `SELECT cm.sender_actor_id, cm.sender_entity_id, cm.payload->>'author' AS author, b.body
       FROM communication_message cm
       JOIN communication_thread t ON t.id = cm.thread_id
       LEFT JOIN content_blob b ON b.id = cm.body_blob_id
       WHERE cm.tenant_id = $1
         AND t.participants->>'channel' = 'portal'
         AND $2::uuid = ANY(t.related_entity_ids)`,
      [TENANT, matterAId],
    )
    expect(rows.rowCount).toBe(1)
    const m = rows.rows[0]!
    expect(m.sender_entity_id).toBe(clientAContactId)
    expect(m.sender_actor_id).toBeNull()
    expect(m.author).toBe('client')
    expect(m.body).toBe('Hello from the client.')
  })

  it('attorney post → sender_actor_id (the attorney), NULL entity, same thread', async () => {
    const { postAttorneyMessage } = await import('@exsto/legal')
    await postAttorneyMessage(attorneyCtx, {
      matterEntityId: matterAId,
      body: 'Thanks, I will review.',
    })

    const threads = await db.query<{ id: string; n: string }>(
      `SELECT t.id, count(cm.id)::text AS n
       FROM communication_thread t
       LEFT JOIN communication_message cm ON cm.thread_id = t.id
       WHERE t.tenant_id = $1
         AND t.participants->>'channel' = 'portal'
         AND $2::uuid = ANY(t.related_entity_ids)
       GROUP BY t.id`,
      [TENANT, matterAId],
    )
    // ONE thread per matter, now holding both messages.
    expect(threads.rowCount).toBe(1)
    expect(Number(threads.rows[0]!.n)).toBe(2)

    const att = await db.query<{
      sender_actor_id: string | null
      sender_entity_id: string | null
      author: string | null
    }>(
      `SELECT cm.sender_actor_id, cm.sender_entity_id, cm.payload->>'author' AS author
       FROM communication_message cm
       JOIN communication_thread t ON t.id = cm.thread_id
       WHERE cm.tenant_id = $1
         AND t.participants->>'channel' = 'portal'
         AND $2::uuid = ANY(t.related_entity_ids)
         AND cm.payload->>'author' = 'attorney'`,
      [TENANT, matterAId],
    )
    expect(att.rowCount).toBe(1)
    const m = att.rows[0]!
    expect(m.sender_actor_id).toBe(ATTORNEY_ACTOR)
    expect(m.sender_entity_id).toBeNull()
    expect(m.author).toBe('attorney')
  })

  it('getMatterThread returns both messages oldest-first, author+body+sentAt only', async () => {
    const { getMatterThread } = await import('@exsto/legal')
    const messages = await getMatterThread(clientCtx, matterAId)
    expect(messages.length).toBe(2)
    expect(messages[0]!.author).toBe('client')
    expect(messages[1]!.author).toBe('attorney')
    expect(messages[0]!.body).toBe('Hello from the client.')
    // Client-safe shape: no actor names / internal payload leak through.
    expect(Object.keys(messages[0]!).sort()).toEqual(['author', 'body', 'sentAt'])
  })

  it('SCOPED: getMatterThread for a different matter (B) returns no messages', async () => {
    const { getMatterThread } = await import('@exsto/legal')
    const messages = await getMatterThread(clientCtx, matterBId)
    expect(messages).toEqual([])
  })

  it('APPEND-ONLY: UPDATE and DELETE on a portal message are rejected', async () => {
    const id = await db.query<{ id: string }>(
      `SELECT cm.id FROM communication_message cm
       JOIN communication_thread t ON t.id = cm.thread_id
       WHERE cm.tenant_id = $1 AND $2::uuid = ANY(t.related_entity_ids)
         AND t.participants->>'channel' = 'portal' LIMIT 1`,
      [TENANT, matterAId],
    )
    const messageId = id.rows[0]!.id
    // The substrate guards append-only with BOTH an RLS policy (cm_no_update /
    // cm_no_delete USING(false)) AND a trigger that raises (invariant 14). The
    // trigger fires first, so a mutation THROWS rather than silently no-op'ing.
    const c = await db.connect()
    try {
      await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT])
      await expect(
        c.query(`UPDATE communication_message SET body_preview = 'tampered' WHERE id = $1`, [
          messageId,
        ]),
      ).rejects.toThrow(/append-only|not permitted|invariant/i)
      await expect(
        c.query(`DELETE FROM communication_message WHERE id = $1`, [messageId]),
      ).rejects.toThrow(/append-only|not permitted|invariant/i)
    } finally {
      c.release()
    }
  })

  it('NOTIFICATION on each post: a legal.notify job is queued with NO message body in the payload', async () => {
    // attorney_portal_message queued by the client post; client_portal_message by
    // the attorney post. Scope to the two messaging routes (the booking that
    // created matter A also queued its own attorney/prospect notifications).
    const jobs = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM worker_job
       WHERE tenant_id = $1 AND job_kind = 'legal.notify'
         AND payload->'variables'->>'matter_entity_id' = $2
         AND payload->>'route' IN ('attorney_portal_message', 'client_portal_message')`,
      [TENANT, matterAId],
    )
    const routes = jobs.rows.map((r) => String(r.payload.route)).sort()
    expect(routes).toEqual(['attorney_portal_message', 'client_portal_message'])

    // No message body in any queued email payload — only links travel.
    const blob = JSON.stringify(jobs.rows.map((r) => r.payload))
    expect(blob).not.toContain('Hello from the client.')
    expect(blob).not.toContain('Thanks, I will review.')
  })

  // ── Route-level per-matter authorization (no oracle) ──────────────────────
  function cookieFor(matterIds: string[]): Promise<string> {
    return import('@/lib/clientSession').then(
      ({ signClientSession, CLIENT_SESSION_COOKIE_NAME }) => {
        const token = signClientSession({
          clientContactId: clientAContactId,
          tenantId: TENANT,
          matterIds,
          email: clientAEmail,
          displayName: 'Msg Client A',
        })
        return `${CLIENT_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`
      },
    )
  }

  function call(toolName: string, input: unknown, cookie?: string): Promise<Response> {
    return import('@/app/api/client/portal/mcp/route').then(({ POST }) =>
      POST(
        new Request('https://app.test/api/client/portal/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
          body: JSON.stringify({ toolName, input }),
        }),
      ),
    )
  }

  it('route: client A reads A’s thread (200), but A’s cookie gets 404 (no oracle) for matter B', async () => {
    const cookie = await cookieFor([matterAId])
    const ok = await call('legal.client.thread_get', { matterEntityId: matterAId }, cookie)
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { result?: { messages?: unknown[] } }
    expect((body.result?.messages ?? []).length).toBe(2)

    const denied = await call('legal.client.thread_get', { matterEntityId: matterBId }, cookie)
    expect(denied.status).toBe(404)
  })

  it('route: client A can post to A via message_post, and it lands as a client message', async () => {
    const cookie = await cookieFor([matterAId])
    const res = await call(
      'legal.client.message_post',
      { matterEntityId: matterAId, body: 'A second client note.' },
      cookie,
    )
    expect(res.status).toBe(200)
    const after = await db.query<{ n: string }>(
      `SELECT count(cm.id)::text AS n
       FROM communication_message cm
       JOIN communication_thread t ON t.id = cm.thread_id
       WHERE cm.tenant_id = $1 AND $2::uuid = ANY(t.related_entity_ids)
         AND t.participants->>'channel' = 'portal'
         AND cm.payload->>'author' = 'client'`,
      [TENANT, matterAId],
    )
    expect(Number(after.rows[0]!.n)).toBe(2)
  })
})
