// S9 invariant — the privilege-ESCALATION floor enforced in Postgres (migration
// 0078). The rank ceiling used to live ONLY in the TypeScript API wrapper
// (verticals/legal/src/api/users.ts), so the GENERIC substrate.action.submit path
// — which dispatches to the registered handler with no API wrapper — and the
// `actor_scope.assign` primitive both bypassed it. CI stayed green because the
// suite only exercised the wrapper. These tests drive the DB floor directly, as a
// restricted human actor under the `authenticated` role (RLS applies), proving the
// hole is closed beneath EVERY adapter:
//
//   ceiling   a firm.admin canNOT grant a peer admin or a super_admin, and canNOT
//             self-promote — the granting actor must STRICTLY out-rank the granted
//             scope (the rank lives on permission_scope_definition.rank, as data)
//   downward  an admin CAN still grant the roles below it (attorney, paralegal),
//             and a super_admin CAN grant admin (but not a peer super_admin)
//   defines   (re)defining the firm's privilege grammar (a permission_scope or a
//             role) requires an admin scope, not merely a wildcard practice scope
//   attribute an action cannot be recorded under — and pass the scope check as —
//             an actor other than the session actor (action.actor_id gate)
//   rank      the ladder ranks are seeded as data: super_admin>admin>attorney>paralegal
//
// Mirrors rbac-enforcement.test.ts: rolled-back transactions, fixtures created as
// the base role, then SET ROLE authenticated to exercise the policies. DB-gated:
// needs SUBSTRATE_TEST_DATABASE_URL (or DATABASE_URL) with migrations through 0078.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const AGENT = '00000000-0000-0000-0001-000000000004' // seeded agent actor (no scopes); records fixture actions

run('invariant: RBAC privilege-escalation floor (migration 0078)', () => {
  let pool: pg.Pool
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      const out = await fn(c)
      await c.query('ROLLBACK')
      return out
    } finally {
      c.release()
    }
  }

  const scopeId = (c: pg.PoolClient, scopeName: string) =>
    c
      .query<{ id: string }>(
        `SELECT id FROM permission_scope_definition
          WHERE tenant_id=$1 AND scope_name=$2 AND (valid_to IS NULL OR valid_to>now()) LIMIT 1`,
        [TENANT, scopeName],
      )
      .then((r) => r.rows[0].id)

  const actionKindId = (c: pg.PoolClient, kindName: string) =>
    c
      .query<{
        id: string
      }>(`SELECT id FROM action_kind_definition WHERE tenant_id=$1 AND kind_name=$2 LIMIT 1`, [
        TENANT,
        kindName,
      ])
      .then((r) => r.rows[0].id)

  // Insert an action row as the base role (bypasses RLS) so attempted assignments
  // and definitions have a valid action_id FK to hang off of.
  async function baseAction(c: pg.PoolClient, kindName: string): Promise<string> {
    const id = randomUUID()
    await c.query(
      `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                           hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
       VALUES ($1,$2,$3,$4,'enforcement','autonomous',now(),0,$4,'{}'::jsonb)`,
      [id, TENANT, await actionKindId(c, kindName), AGENT],
    )
    return id
  }

  // Create a human actor (optionally bound to one ladder scope) as the base role.
  async function human(c: pg.PoolClient, scope?: string): Promise<string> {
    const id = randomUUID()
    await c.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1,$2,'human',$3,'escalation fixture','active')`,
      [id, TENANT, `esc-${id}@test.local`],
    )
    if (scope) {
      const action = await baseAction(c, 'actor_scope.assign')
      await c.query(
        `INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
         VALUES (gen_random_uuid(),$1,$2,$3,$4)`,
        [TENANT, action, id, await scopeId(c, scope)],
      )
    }
    return id
  }

  async function actAs(c: pg.PoolClient, actorId: string): Promise<void> {
    await c.query('SET LOCAL ROLE authenticated')
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT])
    await c.query(`SELECT set_config('app.actor_id', $1, true)`, [actorId])
  }

  // Attempt to grant `scopeIdToGrant` to `targetId` as the current actor; returns
  // true iff the RESTRICTIVE rank-ceiling policy allowed the INSERT.
  async function tryGrant(
    c: pg.PoolClient,
    actionId: string,
    targetId: string,
    scopeIdToGrant: string,
  ): Promise<boolean> {
    await c.query('SAVEPOINT sp')
    try {
      await c.query(
        `INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
         VALUES (gen_random_uuid(),$1,$2,$3,$4)`,
        [TENANT, actionId, targetId, scopeIdToGrant],
      )
      return true
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT sp')
      return false
    }
  }

  it('BLOCKER: a firm.admin cannot grant super_admin or a peer admin, and cannot self-promote', async () => {
    const r = await tx(async (c) => {
      const admin = await human(c, 'firm.admin')
      const target = await human(c) // no scope
      const action = await baseAction(c, 'actor_scope.assign')
      const superScope = await scopeId(c, 'firm.super_admin')
      const adminScope = await scopeId(c, 'firm.admin')
      await actAs(c, admin)
      return {
        grantSuper: await tryGrant(c, action, target, superScope), // escalate a victim up
        grantPeerAdmin: await tryGrant(c, action, target, adminScope), // mint a peer
        selfSuper: await tryGrant(c, action, admin, superScope), // self-escalate
      }
    })
    expect(r.grantSuper).toBe(false)
    expect(r.grantPeerAdmin).toBe(false)
    expect(r.selfSuper).toBe(false)
  })

  it('an admin CAN still grant the roles below it (attorney, paralegal)', async () => {
    const r = await tx(async (c) => {
      const admin = await human(c, 'firm.admin')
      const target = await human(c)
      const action = await baseAction(c, 'actor_scope.assign')
      const attorney = await scopeId(c, 'firm.attorney')
      const paralegal = await scopeId(c, 'firm.paralegal')
      await actAs(c, admin)
      return {
        grantAttorney: await tryGrant(c, action, target, attorney),
        grantParalegal: await tryGrant(c, action, target, paralegal),
      }
    })
    expect(r.grantAttorney).toBe(true)
    expect(r.grantParalegal).toBe(true)
  })

  it('a super_admin can grant admin, but not a peer super_admin', async () => {
    const r = await tx(async (c) => {
      const sa = await human(c, 'firm.super_admin')
      const target = await human(c)
      const action = await baseAction(c, 'actor_scope.assign')
      const adminScope = await scopeId(c, 'firm.admin')
      const superScope = await scopeId(c, 'firm.super_admin')
      await actAs(c, sa)
      return {
        grantAdmin: await tryGrant(c, action, target, adminScope),
        grantPeerSuper: await tryGrant(c, action, target, superScope),
      }
    })
    expect(r.grantAdmin).toBe(true)
    expect(r.grantPeerSuper).toBe(false)
  })

  it('an UNRESTRICTED non-human actor (seed/worker path) is not rank-blocked', async () => {
    // The fail-safe: a system/agent actor with no scopes stays unrestricted, so the
    // bootstrap/provisioning paths that assign the first admins keep working.
    const r = await tx(async (c) => {
      const target = await human(c)
      const action = await baseAction(c, 'actor_scope.assign')
      const superScope = await scopeId(c, 'firm.super_admin')
      await actAs(c, AGENT)
      return { grantSuper: await tryGrant(c, action, target, superScope) }
    })
    expect(r.grantSuper).toBe(true)
  })

  it('(re)defining the firm privilege grammar requires an admin scope, not a wildcard', async () => {
    const tryInsertScopeDef = async (c: pg.PoolClient, actionId: string) => {
      await c.query('SAVEPOINT sp')
      try {
        await c.query(
          `INSERT INTO permission_scope_definition
             (id, tenant_id, action_id, scope_name, display_name, action_kinds, entity_kinds,
              attribute_kinds, row_filter_expression, rank, status)
           VALUES (gen_random_uuid(),$1,$2,$3,'x','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,0,'active')`,
          [TENANT, actionId, `esc.scope.${randomUUID()}`],
        )
        return true
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT sp')
        return false
      }
    }
    const tryInsertRoleDef = async (c: pg.PoolClient, actionId: string) => {
      await c.query('SAVEPOINT sp')
      try {
        await c.query(
          `INSERT INTO role_definition
             (id, tenant_id, action_id, role_name, display_name, default_permission_scopes, status)
           VALUES (gen_random_uuid(),$1,$2,$3,'x','[]'::jsonb,'active')`,
          [TENANT, actionId, `esc.role.${randomUUID()}`],
        )
        return true
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT sp')
        return false
      }
    }

    const r = await tx(async (c) => {
      const attorney = await human(c, 'firm.attorney') // wildcard practice scope, NOT admin
      const admin = await human(c, 'firm.admin')
      const action = await baseAction(c, 'permission_scope.define')

      await actAs(c, attorney)
      const attorneyOut = {
        scope: await tryInsertScopeDef(c, action),
        role: await tryInsertRoleDef(c, action),
      }

      await actAs(c, admin)
      const adminOut = {
        scope: await tryInsertScopeDef(c, action),
        role: await tryInsertRoleDef(c, action),
      }
      return { attorneyOut, adminOut }
    })
    expect(r.attorneyOut.scope).toBe(false)
    expect(r.attorneyOut.role).toBe(false)
    expect(r.adminOut.scope).toBe(true)
    expect(r.adminOut.role).toBe(true)
  })

  it('an action cannot be attributed to an actor other than the session actor', async () => {
    // The 0078 action write-gate keys on private.current_actor_id() AND requires
    // action.actor_id to equal it — so a write cannot pose as a different (more
    // privileged) actor to pass the scope check.
    const tryAction = async (c: pg.PoolClient, kindId: string, rowActorId: string) => {
      await c.query('SAVEPOINT sp')
      try {
        await c.query(
          `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                               hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
           VALUES (gen_random_uuid(),$1,$2,$3,'exploration','autonomous',now(),0,$3,'{}'::jsonb)`,
          [TENANT, kindId, rowActorId],
        )
        return true
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT sp')
        return false
      }
    }
    const r = await tx(async (c) => {
      const admin = await human(c, 'firm.admin')
      const other = await human(c, 'firm.admin')
      const entityCreate = await actionKindId(c, 'entity.create')
      await actAs(c, admin)
      return {
        asSelf: await tryAction(c, entityCreate, admin), // actor_id == session actor
        asOther: await tryAction(c, entityCreate, other), // actor_id != session actor
      }
    })
    expect(r.asSelf).toBe(true)
    expect(r.asOther).toBe(false)
  })

  it('rank is seeded as data: super_admin > admin > attorney > paralegal', async () => {
    const r = await tx(async (c) => {
      const rows = await c.query<{ scope_name: string; rank: number }>(
        `SELECT scope_name, rank FROM permission_scope_definition
          WHERE tenant_id=$1 AND scope_name = ANY($2::text[]) AND (valid_to IS NULL OR valid_to>now())`,
        [TENANT, ['firm.super_admin', 'firm.admin', 'firm.attorney', 'firm.paralegal']],
      )
      return Object.fromEntries(rows.rows.map((x) => [x.scope_name, x.rank]))
    })
    expect(r['firm.super_admin']).toBeGreaterThan(r['firm.admin'])
    expect(r['firm.admin']).toBeGreaterThan(r['firm.attorney'])
    expect(r['firm.attorney']).toBeGreaterThan(r['firm.paralegal'])
  })
})
