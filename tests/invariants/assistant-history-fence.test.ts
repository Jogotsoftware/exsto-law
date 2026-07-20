// AI-CONTEXT A6 — portal↔attorney chat history isolation fence.
//
// clientAssistantChat.ts records every portal-client turn as an assistant.turn
// event with primary_entity_id = the client's own client_contact id (scope
// 'contact', no chat_session_id). The attorney-side legacy thread reader
// (listAssistantThread in assistantChat.ts, no-chat_session_id branch) selects
// assistant.turn rows by that SAME primary_entity_id when an attorney opens a
// contact's thread — so without a fence, the portal client's own Q&A would
// surface in the attorney's view (and get re-fed as model history).
//
// Two independent, redundant fences close this:
//   (1) actor fence — excludes rows whose source actor is the contact's own
//       portal actor (external_id = 'client:<contactId>', migration 0135).
//       Backfill-safe: works on rows that predate this fix, no payload needed.
//   (2) surface fence — excludes rows tagged payload.surface = 'portal'
//       (recordAssistantTurn's `surface` param, set by clientAssistantChat.ts
//       going forward).
//
// This test proves each fence independently sufficient, and that the
// chat-session branch (used by WP-D2 session-scoped reads) is unaffected —
// it has no fence because a portal turn never carries a chat_session_id.
//
// DB-gated (skipped without a DATABASE_URL — no local Docker; runs against a
// real seeded substrate, e.g. in CI's invariants job).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { recordAssistantTurn, listAssistantThread } from '@exsto/legal'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
// A real, active human actor seeded by the core foundation — used as the
// attorney ctx for both recording the attorney's own turn and reading the
// contact's thread back.
const ATTORNEY_ACTOR = '00000000-0000-0000-0001-000000000002'

run('assistant history fence (portal ↔ attorney isolation)', { timeout: 90_000 }, () => {
  const db = new pg.Pool({ connectionString: url })
  const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY_ACTOR }

  // Fresh fixture actors per run so parallel test runs never collide.
  const portalActor = randomUUID() // this contact's REAL portal actor
  const otherActor = randomUUID() // some unrelated actor (not client-prefixed)
  let contactId = ''
  const sessionId = randomUUID()

  async function anyActionId(): Promise<string> {
    const r = await db.query<{ id: string }>(`SELECT id FROM action WHERE tenant_id = $1 LIMIT 1`, [
      TENANT,
    ])
    return r.rows[0]!.id
  }

  async function makeActor(actorId: string, externalId: string | null): Promise<void> {
    await db.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1, $2, 'human', $3, 'history-fence fixture', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [actorId, TENANT, externalId],
    )
  }

  async function makeClientContact(): Promise<string> {
    const id = randomUUID()
    const kind = (
      await db.query<{ id: string }>(
        `SELECT id FROM entity_kind_definition WHERE tenant_id = $1 AND kind_name = 'client_contact' LIMIT 1`,
        [TENANT],
      )
    ).rows[0]!.id
    await db.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1, $2, $3, $4, 'history-fence contact', 'active', '{}'::jsonb)`,
      [id, TENANT, await anyActionId(), kind],
    )
    return id
  }

  beforeAll(async () => {
    contactId = await makeClientContact()
    // The contact's REAL portal actor — external_id follows the migration-0135
    // contract exactly ('client:<contactId>'), same as
    // legal.client.provision_portal_actor mints in production.
    await makeActor(portalActor, `client:${contactId}`)
    // An unrelated actor with a non-client external_id — used to prove the
    // surface fence works even when the actor fence would NOT catch the row.
    await makeActor(otherActor, `history-fence-other-${otherActor.slice(0, 8)}@example.test`)

    // 1. The attorney's own turn on this contact's thread — must survive.
    await recordAssistantTurn(attorneyCtx, {
      message: 'ATTORNEY_MSG',
      reply: 'attorney reply',
      provider: 'anthropic',
      model: 'test',
      kind: 'question',
      citations: [],
      scope: 'contact',
      primaryEntityId: contactId,
    })

    // 2. A portal turn recorded from the contact's OWN portal actor, with NO
    // surface tag — this is what every row recorded before this fix looks
    // like (backfill data). Must be excluded via the ACTOR fence alone.
    await recordAssistantTurn(
      { tenantId: TENANT, actorId: portalActor },
      {
        message: 'PORTAL_ACTOR_FENCE_MSG',
        reply: 'portal reply',
        provider: 'anthropic',
        model: 'test',
        kind: 'question',
        citations: [],
        scope: 'contact',
        primaryEntityId: contactId,
      },
    )

    // 3. A turn from an UNRELATED actor (not the contact's portal actor, so
    // the actor fence would NOT trigger) but tagged surface: 'portal'. Must
    // be excluded via the SURFACE fence alone — proves the two fences are
    // independently sufficient (belt-and-braces).
    await recordAssistantTurn(
      { tenantId: TENANT, actorId: otherActor },
      {
        message: 'PORTAL_SURFACE_FENCE_MSG',
        reply: 'portal reply 2',
        provider: 'anthropic',
        model: 'test',
        kind: 'question',
        citations: [],
        scope: 'contact',
        primaryEntityId: contactId,
        surface: 'portal',
      },
    )

    // 4. A session-scoped turn from the portal actor. Real portal code never
    // sets chatSessionId, but this proves the session-id branch applies NO
    // fence (it needs none — a real portal turn can never land here).
    await recordAssistantTurn(
      { tenantId: TENANT, actorId: portalActor },
      {
        message: 'SESSION_MSG',
        reply: 'session reply',
        provider: 'anthropic',
        model: 'test',
        kind: 'question',
        citations: [],
        scope: 'contact',
        primaryEntityId: contactId,
        chatSessionId: sessionId,
      },
    )

    // 5. Regression guard for a null-propagation trap in the actor fence: on
    // the GLOBAL thread (primary_entity_id IS NULL), 'client:' || NULL is
    // NULL, and `external_id IS DISTINCT FROM NULL` is FALSE whenever the
    // turn's own actor ALSO has a null external_id — which would wrongly
    // exclude that actor's global-thread turns entirely. ATTORNEY_ACTOR (the
    // core-seeded 'Founder' actor) has external_id = NULL, so recording a
    // global turn as that actor exercises exactly this path.
    await recordAssistantTurn(attorneyCtx, {
      message: 'GLOBAL_NULL_EXTERNAL_ID_MSG',
      reply: 'global reply',
      provider: 'anthropic',
      model: 'test',
      kind: 'question',
      citations: [],
      scope: 'global',
      primaryEntityId: null,
    })
  })

  afterAll(async () => {
    // Best-effort: actor rows are referenced by action.actor_id (FK), so
    // cleanup may fail once the action layer has written through them —
    // that's fine, this is a disposable dev-tenant fixture.
    await db
      .query(`DELETE FROM actor WHERE id = ANY($1::uuid[])`, [[portalActor, otherActor]])
      .catch(() => {})
    await db.end()
    await closeDbPool()
  })

  it('the legacy (no-session) thread read returns only the attorney turn', async () => {
    const entries = await listAssistantThread(attorneyCtx, { contactEntityId: contactId })
    const userMessages = entries.filter((e) => e.role === 'user').map((e) => e.message)
    expect(userMessages).toEqual(['ATTORNEY_MSG'])
  })

  it('excludes a portal turn via the actor fence even with no surface tag', async () => {
    const entries = await listAssistantThread(attorneyCtx, { contactEntityId: contactId })
    expect(entries.some((e) => e.message === 'PORTAL_ACTOR_FENCE_MSG')).toBe(false)
  })

  it('excludes a surface-tagged turn even from an actor the actor-fence would not catch', async () => {
    const entries = await listAssistantThread(attorneyCtx, { contactEntityId: contactId })
    expect(entries.some((e) => e.message === 'PORTAL_SURFACE_FENCE_MSG')).toBe(false)
  })

  it('leaves the chat-session branch unaffected by the fence', async () => {
    const entries = await listAssistantThread(attorneyCtx, { chatSessionId: sessionId })
    const userMessages = entries.filter((e) => e.role === 'user').map((e) => e.message)
    expect(userMessages).toEqual(['SESSION_MSG'])
  })

  it('does not drop a global-thread turn whose actor also has a null external_id', async () => {
    // The global thread is shared tenant-wide (not scoped to this fixture's
    // contact), so other rows may legitimately be present — assert inclusion,
    // not exact equality.
    const entries = await listAssistantThread(attorneyCtx, {})
    expect(entries.some((e) => e.message === 'GLOBAL_NULL_EXTERNAL_ID_MSG')).toBe(true)
  })
})
