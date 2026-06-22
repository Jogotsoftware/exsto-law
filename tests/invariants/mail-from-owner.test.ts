// from=owner: outbound client mail should send FROM the matter owner's mailbox
// when the owner has a usable Gmail send connection, else fall back to the actual
// sender, else the firm-primary. resolveSendAsActor encodes that chain. This proves
// (a) a connected owner is chosen, and (b) an UNCONNECTED owner is skipped (the
// fallback) — so a matter owned by an attorney who hasn't linked Gmail never
// hard-fails the send.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { closeDbPool } from '@exsto/shared'
import { setMatterOwner, resolveSendAsActor } from '@exsto/legal'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN_ACTOR = '00000000-0000-0000-0001-000000000002' // seeded (set_owner authority)
const adminCtx = { tenantId: TENANT, actorId: ADMIN_ACTOR }

run('mail from=owner — send-as resolution', { timeout: 90_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  const connectedOwner = randomUUID() // owner WITH a Gmail send connection
  const unconnectedOwner = randomUUID() // owner WITHOUT one
  const caller = randomUUID() // the actor triggering the send (also unconnected)
  const callerCtx = { tenantId: TENANT, actorId: caller }
  let connectedMatter: string
  let unconnectedMatter: string

  async function anyActionId(): Promise<string> {
    const r = await db.query<{ id: string }>(`SELECT id FROM action WHERE tenant_id = $1 LIMIT 1`, [
      TENANT,
    ])
    return r.rows[0]!.id
  }
  async function makeActor(actorId: string): Promise<void> {
    await db.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1, $2, 'human', $3, 'from-owner fixture', 'active') ON CONFLICT (id) DO NOTHING`,
      [actorId, TENANT, `fo-${actorId.slice(0, 8)}@example.test`],
    )
  }
  async function makeMatter(): Promise<string> {
    const id = randomUUID()
    const kind = (
      await db.query<{ id: string }>(
        `SELECT id FROM entity_kind_definition WHERE tenant_id = $1 AND kind_name = 'matter' LIMIT 1`,
        [TENANT],
      )
    ).rows[0]!.id
    await db.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1, $2, $3, $4, 'from-owner matter', 'active', '{}'::jsonb)`,
      [id, TENANT, await anyActionId(), kind],
    )
    return id
  }
  // A 'connected' Google connection with the gmail.send scope for an actor.
  async function connectGoogle(actorId: string, email: string): Promise<void> {
    await db.query(
      `INSERT INTO legal_integration_connection
         (tenant_id, actor_id, provider, status, account_email, scope, vault_secret_name)
       VALUES ($1, $2, 'google', 'connected', $3,
               'https://www.googleapis.com/auth/gmail.send', $4)
       ON CONFLICT (tenant_id, provider, COALESCE(actor_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET status = 'connected', account_email = EXCLUDED.account_email, scope = EXCLUDED.scope`,
      [TENANT, actorId, email, `vault-${actorId}`],
    )
  }

  beforeAll(async () => {
    await makeActor(connectedOwner)
    await makeActor(unconnectedOwner)
    await makeActor(caller)
    // The ONLY Gmail connection in this fixture set → also the firm-primary.
    await connectGoogle(connectedOwner, 'connected-owner@pacheco.test')

    connectedMatter = await makeMatter()
    await setMatterOwner(adminCtx, {
      matterEntityId: connectedMatter,
      ownerActorId: connectedOwner,
    })
    unconnectedMatter = await makeMatter()
    await setMatterOwner(adminCtx, {
      matterEntityId: unconnectedMatter,
      ownerActorId: unconnectedOwner,
    })
  })

  afterAll(async () => {
    await db.query(`DELETE FROM legal_integration_connection WHERE actor_id = $1`, [connectedOwner])
    await db.end()
    await closeDbPool()
  })

  it('sends from the matter owner when the owner has a Gmail send connection', async () => {
    expect(await resolveSendAsActor(callerCtx, connectedMatter)).toBe(connectedOwner)
  })

  it('skips an unconnected owner and falls back (here: to the firm-primary)', async () => {
    // unconnectedOwner has no connection; caller has none either → the only connected
    // actor (connectedOwner) is the firm-primary fallback.
    expect(await resolveSendAsActor(callerCtx, unconnectedMatter)).toBe(connectedOwner)
  })

  it('falls back for an unowned/null matter', async () => {
    expect(await resolveSendAsActor(callerCtx, null)).toBe(connectedOwner)
  })
})
