// PR B (0088) — matter ownership + send authorization. An attorney may send
// client mail / signature requests on a matter only if they OWN it, are GRANTED
// access, or are a firm admin; a matter with no owner is firm-shared (any
// attorney may send). Authorization is enforced in the operation-core API
// (assertCanSendOnMatter) and, for ownership changes, INSIDE the action handler —
// so the generic substrate.action.submit path cannot bypass it (the escalation
// class RBAC 0078 closed).
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
  createMatter,
  submitBooking,
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
const PUBLIC_INTAKE_ACTOR = '00000000-0000-0000-0001-000000000005'
const ownerCtx = { tenantId: TENANT, actorId: OWNER_ACTOR }

run('mail send authorization — matter ownership (0088)', { timeout: 90_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  const otherActor = randomUUID() // a real attorney who is NOT this matter's owner
  const adminActor = randomUUID() // a firm admin who is NOT this matter's owner
  const otherCtx = { tenantId: TENANT, actorId: otherActor }
  const adminCtx = { tenantId: TENANT, actorId: adminActor }
  let matterId: string
  // A BOOKING matter (client_of + email link — the shape the mail send path reads
  // via clientEmailIndex), then owner-assigned so the send guard bites end-to-end.
  let bookingMatterId: string
  let bookingClientEmail: string

  // Create a human actor (active) bound to one ladder scope, committed via the
  // owner connection (mirrors the rbac fixtures). Needs an action_id FK.
  async function makeActor(actorId: string, scopeName: string): Promise<void> {
    await db.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1, $2, 'human', $3, 'PR-B fixture', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [actorId, TENANT, `prb-${actorId.slice(0, 8)}@example.test`],
    )
    const action = await db.query<{ id: string }>(
      `SELECT id FROM action WHERE tenant_id = $1 LIMIT 1`,
      [TENANT],
    )
    const scope = await db.query<{ id: string }>(
      `SELECT id FROM permission_scope_definition
        WHERE tenant_id = $1 AND scope_name = $2 AND (valid_to IS NULL OR valid_to > now())
        LIMIT 1`,
      [TENANT, scopeName],
    )
    await db.query(
      `INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [TENANT, action.rows[0]!.id, actorId, scope.rows[0]!.id],
    )
  }

  beforeAll(async () => {
    // An attorney-created matter is owner-stamped to its creator (0088).
    const created = await createMatter(ownerCtx, {
      matterNumber: `PRB-${randomUUID().slice(0, 8)}`,
      clientFullName: 'PR-B Client',
      clientEmail: `prb-client-${randomUUID().slice(0, 8)}@example.test`,
      practiceArea: 'business',
      summary: 'mail-send-authz fixture',
    })
    matterId = (created.effects[0] as { matterEntityId: string }).matterEntityId
    await makeActor(otherActor, 'firm.attorney')
    await makeActor(adminActor, 'firm.admin')

    // Booking matter: public intake → client_of + email link (visible to the mail
    // send path), unowned. Then assign OWNER_ACTOR so the send guard has teeth.
    bookingClientEmail = `prb-deny-${randomUUID().slice(0, 8)}@example.test`
    const start = new Date(
      Date.now() + (90 + Math.floor(Math.random() * 100000)) * 24 * 3600 * 1000,
    )
    start.setUTCHours(15, 0, 0, 0)
    const booking = await submitBooking(
      { tenantId: TENANT, actorId: PUBLIC_INTAKE_ACTOR },
      {
        clientFullName: 'PR-B Deny Client',
        clientEmail: bookingClientEmail,
        attributionSource: 'prb-test',
        serviceKey: 'nc_llc_single_member',
        intakeResponses: { company_name: 'PR-B Deny LLC', company_purpose: 'deny test' },
        scheduledAtIso: start.toISOString(),
        scheduledEndIso: new Date(start.getTime() + 1800e3).toISOString(),
      },
    )
    bookingMatterId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
    await setMatterOwner(ownerCtx, { matterEntityId: bookingMatterId, ownerActorId: OWNER_ACTOR })
  })

  afterAll(async () => {
    await db.end()
    await closeDbPool()
  })

  it('stamps the creating attorney as matter_owner', async () => {
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
    // Insert a bare matter entity with NO matter_owner attribute (mimics a pre-0088
    // / public-booking matter), bypassing the create handlers.
    const bareMatter = randomUUID()
    const kind = await db.query<{ id: string }>(
      `SELECT id FROM entity_kind_definition WHERE tenant_id = $1 AND kind_name = 'matter' LIMIT 1`,
      [TENANT],
    )
    const action = await db.query<{ id: string }>(
      `SELECT id FROM action WHERE tenant_id = $1 LIMIT 1`,
      [TENANT],
    )
    await db.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1, $2, $3, $4, 'PR-B unowned matter', 'active', '{}'::jsonb)`,
      [bareMatter, TENANT, action.rows[0]!.id, kind.rows[0]!.id],
    )
    expect(await getMatterAccess(otherCtx, bareMatter)).toMatchObject({ ownerActorId: null })
    expect(await canSendOnMatter(otherCtx, bareMatter)).toBe(true)
  })

  // End-to-end (finding #1): the guard must fire INSIDE the real send functions —
  // not just the helper — and BEFORE the outbound adapter. If the guard were
  // removed, these calls would instead fail at the Gmail/notification adapter with
  // a DIFFERENT message, so matching /not authorized/i proves the guard fired.

  it('enqueueClientEmail rejects an unauthorized attorney before the Gmail send', async () => {
    await expect(
      enqueueClientEmail(otherCtx, { to: bookingClientEmail, subject: 'PR-B', body: 'hi' }),
    ).rejects.toThrow(/not authorized/i)
  })

  it('postAttorneyMessage rejects an unauthorized attorney before notifying the client', async () => {
    await expect(
      postAttorneyMessage(otherCtx, { matterEntityId: bookingMatterId, body: 'hi' }),
    ).rejects.toThrow(/not authorized/i)
  })

  it('once granted, enqueueClientEmail gets PAST authz (fails later, not on authz)', async () => {
    await grantMatterAccess(ownerCtx, { matterEntityId: bookingMatterId, actorIds: [otherActor] })
    let err: Error | null = null
    try {
      await enqueueClientEmail(otherCtx, { to: bookingClientEmail, subject: 'PR-B', body: 'hi' })
    } catch (e) {
      err = e as Error
    }
    // It got past authorization: either it sent, or it failed at the Gmail adapter
    // (no test connection) — but NOT with an authorization error.
    expect(err?.message ?? '').not.toMatch(/not authorized/i)
  })
})
