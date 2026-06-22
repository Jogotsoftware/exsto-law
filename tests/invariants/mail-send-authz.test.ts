// PR B (0088) — matter ownership + send authorization. An attorney may send
// client mail / signature requests on a matter only if they OWN it, are GRANTED
// access, or are a firm admin; a matter with no owner is firm-shared (any
// attorney may send). Authorization is enforced in the operation-core API
// (assertCanSendOnMatter) and, for ownership changes, INSIDE the action handler —
// so the generic substrate.action.submit path cannot bypass it (the escalation
// class RBAC 0078 closed).
//
// Owners are assigned via legal.matter.set_owner (there is no usable
// create-time stamp: the real create path is the PUBLIC matter.open, whose actor
// is the intake actor, and legal.matter.create is a phantom kind — 0078). So the
// fixtures here create bare matters and assign owners explicitly, exactly as the
// (future) assignment step will.
//
// DB-gated (live DB). Importing @exsto/legal registers the legal action handlers
// (and the generic primitives) as a side effect. In CI the substrate pool connects
// as the owner role (no SUBSTRATE_DB_ROLE), so RLS is bypassed and the handler /
// api authorization checks under test ARE the decisive gate — which is the point.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { closeDbPool } from '@exsto/shared'
import {
  canSendOnMatter,
  assertCanSendOnMatter,
  getMatterAccess,
  setMatterOwner,
  grantMatterAccess,
  enqueueClientEmail,
  postAttorneyMessage,
} from '@exsto/legal'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const OWNER_ACTOR = '00000000-0000-0000-0001-000000000002' // seeded attorney
const ownerCtx = { tenantId: TENANT, actorId: OWNER_ACTOR }

run('mail send authorization — matter ownership (0088)', { timeout: 90_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  const otherActor = randomUUID() // a real attorney who is NOT this matter's owner
  const adminActor = randomUUID() // a firm admin who is NOT this matter's owner
  const otherCtx = { tenantId: TENANT, actorId: otherActor }
  const adminCtx = { tenantId: TENANT, actorId: adminActor }
  let matterId: string // owned by OWNER_ACTOR
  let linkedMatterId: string // owned + a client_of/email link (mail send path shape)
  let linkedClientEmail: string

  // Reuse any existing action row for FK columns on directly-inserted fixtures.
  async function anyActionId(): Promise<string> {
    const r = await db.query<{ id: string }>(`SELECT id FROM action WHERE tenant_id = $1 LIMIT 1`, [
      TENANT,
    ])
    return r.rows[0]!.id
  }
  async function kindId(table: string, name: string): Promise<string> {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE tenant_id = $1 AND kind_name = $2 LIMIT 1`,
      [TENANT, name],
    )
    return r.rows[0]!.id
  }
  // permission_scope_definition keys on scope_name (not kind_name).
  async function scopeId(scopeName: string): Promise<string> {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM permission_scope_definition
        WHERE tenant_id = $1 AND scope_name = $2 AND (valid_to IS NULL OR valid_to > now())
        LIMIT 1`,
      [TENANT, scopeName],
    )
    return r.rows[0]!.id
  }

  // A bare 'matter' entity (no owner), inserted directly (owner connection, RLS off).
  async function makeMatter(): Promise<string> {
    const id = randomUUID()
    await db.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1, $2, $3, $4, 'PR-B matter', 'active', '{}'::jsonb)`,
      [id, TENANT, await anyActionId(), await kindId('entity_kind_definition', 'matter')],
    )
    return id
  }

  // Link a client_contact (email) to a matter via client_of — the exact shape the
  // mail send path's clientEmailIndex reads (client_of + email + kind client_contact).
  async function linkClientContact(matterEntityId: string, email: string): Promise<void> {
    const action = await anyActionId()
    const contactId = randomUUID()
    await db.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1, $2, $3, $4, 'PR-B Contact', 'active', '{}'::jsonb)`,
      [contactId, TENANT, action, await kindId('entity_kind_definition', 'client_contact')],
    )
    await db.query(
      `INSERT INTO attribute
         (id, tenant_id, action_id, entity_id, attribute_kind_id, value, confidence,
          knowability_state, time_precision, source_type, source_ref)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, to_jsonb($5::text), 1.0,
               'observed', 'exact_instant', 'human', $6)`,
      [
        TENANT,
        action,
        contactId,
        await kindId('attribute_kind_definition', 'email'),
        email,
        OWNER_ACTOR,
      ],
    )
    await db.query(
      `INSERT INTO relationship
         (id, tenant_id, action_id, source_entity_id, target_entity_id, relationship_kind_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [
        TENANT,
        action,
        contactId,
        matterEntityId,
        await kindId('relationship_kind_definition', 'client_of'),
      ],
    )
  }

  // A human actor (active) bound to one ladder scope, committed via the owner
  // connection (mirrors the rbac fixtures). Needs an action_id FK.
  async function makeActor(actorId: string, scopeName: string): Promise<void> {
    await db.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1, $2, 'human', $3, 'PR-B fixture', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [actorId, TENANT, `prb-${actorId.slice(0, 8)}@example.test`],
    )
    await db.query(
      `INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [TENANT, await anyActionId(), actorId, await scopeId(scopeName)],
    )
  }

  beforeAll(async () => {
    await makeActor(otherActor, 'firm.attorney')
    await makeActor(adminActor, 'firm.admin')

    // Owned matter (assigned via the real set_owner action — the path that will
    // back the future assignment step).
    matterId = await makeMatter()
    await setMatterOwner(ownerCtx, { matterEntityId: matterId, ownerActorId: OWNER_ACTOR })

    // Owned matter WITH a client_of/email link, so the mail send path can resolve
    // it and the guard can be exercised end-to-end.
    linkedMatterId = await makeMatter()
    await setMatterOwner(ownerCtx, { matterEntityId: linkedMatterId, ownerActorId: OWNER_ACTOR })
    linkedClientEmail = `prb-deny-${randomUUID().slice(0, 8)}@example.test`
    await linkClientContact(linkedMatterId, linkedClientEmail)
  })

  afterAll(async () => {
    await db.end()
    await closeDbPool()
  })

  it('set_owner assigns the matter owner', async () => {
    const access = await getMatterAccess(ownerCtx, matterId)
    expect(access.ownerActorId).toBe(OWNER_ACTOR)
  })

  it('owner may send; a non-owner non-admin attorney may not', async () => {
    expect(await canSendOnMatter(ownerCtx, matterId)).toBe(true)
    expect(await canSendOnMatter(otherCtx, matterId)).toBe(false)
    await expect(assertCanSendOnMatter(otherCtx, matterId)).rejects.toThrow(/not authorized/i)
  })

  it('a firm admin may send on a matter they do not own', async () => {
    expect(await canSendOnMatter(adminCtx, matterId)).toBe(true)
  })

  it('granting access lets the other attorney send', async () => {
    await grantMatterAccess(ownerCtx, { matterEntityId: matterId, actorIds: [otherActor] })
    expect(await canSendOnMatter(otherCtx, matterId)).toBe(true)
    const access = await getMatterAccess(ownerCtx, matterId)
    expect(access.grantedActorIds).toContain(otherActor)
  })

  it('a non-owner non-admin cannot seize ownership via the action layer', async () => {
    // setMatterOwner → submitAction(legal.matter.set_owner); the HANDLER enforces,
    // so this holds even through the generic action path that skips the api wrapper.
    await expect(
      setMatterOwner(otherCtx, { matterEntityId: matterId, ownerActorId: otherActor }),
    ).rejects.toThrow(/owner or a firm admin/i)
    const access = await getMatterAccess(ownerCtx, matterId)
    expect(access.ownerActorId).toBe(OWNER_ACTOR) // unchanged
  })

  it('a non-owner non-admin (even if granted) cannot change the grant list', async () => {
    // otherActor was granted send access above, but a grantee still cannot re-grant.
    await expect(
      grantMatterAccess(otherCtx, { matterEntityId: matterId, actorIds: [adminActor] }),
    ).rejects.toThrow(/owner or a firm admin/i)
  })

  it('an UNOWNED matter (legacy / public-booking) is firm-shared: any attorney may send', async () => {
    const unowned = await makeMatter()
    expect(await getMatterAccess(otherCtx, unowned)).toMatchObject({ ownerActorId: null })
    expect(await canSendOnMatter(otherCtx, unowned)).toBe(true)
  })

  // End-to-end: the guard must fire INSIDE the real send functions — not just the
  // helper — and BEFORE the outbound adapter. If the guard were removed, these
  // calls would instead fail at the Gmail/notification adapter with a DIFFERENT
  // message, so matching /not authorized/i proves the guard fired.

  it('enqueueClientEmail rejects an unauthorized attorney before the Gmail send', async () => {
    await expect(
      enqueueClientEmail(otherCtx, { to: linkedClientEmail, subject: 'PR-B', body: 'hi' }),
    ).rejects.toThrow(/not authorized/i)
  })

  it('postAttorneyMessage rejects an unauthorized attorney before notifying the client', async () => {
    await expect(
      postAttorneyMessage(otherCtx, { matterEntityId: linkedMatterId, body: 'hi' }),
    ).rejects.toThrow(/not authorized/i)
  })

  it('once granted, enqueueClientEmail gets PAST authz (fails later, not on authz)', async () => {
    await grantMatterAccess(ownerCtx, { matterEntityId: linkedMatterId, actorIds: [otherActor] })
    let err: Error | null = null
    try {
      await enqueueClientEmail(otherCtx, { to: linkedClientEmail, subject: 'PR-B', body: 'hi' })
    } catch (e) {
      err = e as Error
    }
    // It got past authorization: either it sent, or it failed at the Gmail adapter
    // (no test connection) — but NOT with an authorization error.
    expect(err?.message ?? '').not.toMatch(/not authorized/i)
  })
})
