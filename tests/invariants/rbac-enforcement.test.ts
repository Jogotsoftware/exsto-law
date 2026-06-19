// S9 WP9.2 invariant — RBAC scope ENFORCEMENT (migration 0073), not just
// "policies exist". Under the non-owner role `authenticated` (RLS applies),
// proves: a scope-restricted actor is blocked from out-of-scope actions and
// out-of-scope reads, allowed in-scope ones, while an actor with no scopes keeps
// full access (backward-compatible). Fully self-contained: every fixture is
// created in a rolled-back transaction using CORE seed kinds only (person is in
// firm.paralegal's entity_kinds, organization is not), so it does not depend on
// any vertical/demo data. DB-gated: needs SUBSTRATE_TEST_DATABASE_URL (or
// DATABASE_URL) and migrations 0073/0074 applied.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const AGENT = '00000000-0000-0000-0001-000000000004' // seeded agent actor, no scopes -> unrestricted

run('invariant: RBAC scope enforcement (migration 0073)', () => {
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

  const actionKindId = (c: pg.PoolClient, name: string) =>
    c
      .query<{
        id: string
      }>(`SELECT id FROM action_kind_definition WHERE tenant_id=$1 AND kind_name=$2`, [
        TENANT,
        name,
      ])
      .then((r) => r.rows[0].id)

  const entityKindId = (c: pg.PoolClient, name: string) =>
    c
      .query<{
        id: string
      }>(`SELECT id FROM entity_kind_definition WHERE tenant_id=$1 AND kind_name=$2`, [
        TENANT,
        name,
      ])
      .then((r) => r.rows[0].id)

  async function insertAction(
    c: pg.PoolClient,
    actionKind: string,
    actorId: string,
  ): Promise<void> {
    await c.query(
      `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                           hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
       VALUES (gen_random_uuid(), $1, $2, $3, 'exploration', 'autonomous', now(), 0, $3, '{}'::jsonb)`,
      [TENANT, await actionKindId(c, actionKind), actorId],
    )
  }

  // Create (as the owner/base role — bypass RLS) a restricted firm.paralegal
  // actor plus two fixture entities: a person (in firm.paralegal.entity_kinds)
  // and an organization (not). Returns the ids.
  async function seedFixtures(c: pg.PoolClient) {
    const restricted = randomUUID()
    await c.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1, $2, 'human', $3, 'RBAC test paralegal', 'active')`,
      [restricted, TENANT, `rbac-${restricted}@test.local`],
    )
    const scopeId = (
      await c.query<{ id: string }>(
        `SELECT id FROM permission_scope_definition
          WHERE tenant_id=$1 AND scope_name='firm.paralegal' AND (valid_to IS NULL OR valid_to>now()) LIMIT 1`,
        [TENANT],
      )
    ).rows[0].id

    const assignAction = randomUUID()
    await c.query(
      `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                           hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
       VALUES ($1, $2, $3, $4, 'enforcement', 'autonomous', now(), 0, $4, '{}'::jsonb)`,
      [assignAction, TENANT, await actionKindId(c, 'actor_scope.assign'), AGENT],
    )
    await c.query(
      `INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [TENANT, assignAction, restricted, scopeId],
    )

    const entAction = randomUUID()
    await c.query(
      `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                           hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
       VALUES ($1, $2, $3, $4, 'exploration', 'autonomous', now(), 0, $4, '{}'::jsonb)`,
      [entAction, TENANT, await actionKindId(c, 'entity.create'), AGENT],
    )
    const inScope = randomUUID()
    const outScope = randomUUID()
    await c.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1,$2,$3,$4,'fixture in-scope','active','{}'::jsonb)`,
      [inScope, TENANT, entAction, await entityKindId(c, 'person')],
    )
    await c.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1,$2,$3,$4,'fixture out-of-scope','active','{}'::jsonb)`,
      [outScope, TENANT, entAction, await entityKindId(c, 'organization')],
    )
    return { restricted, inScope, outScope }
  }

  async function actAs(c: pg.PoolClient, actorId: string): Promise<void> {
    await c.query('SET LOCAL ROLE authenticated')
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT])
    await c.query(`SELECT set_config('app.actor_id', $1, true)`, [actorId])
  }

  const canSee = (c: pg.PoolClient, id: string) =>
    c
      .query<{ n: number }>(`SELECT count(*)::int AS n FROM entity WHERE id=$1`, [id])
      .then((r) => r.rows[0].n)

  it('blocks an out-of-scope action and allows an in-scope one', async () => {
    const r = await tx(async (c) => {
      const { restricted } = await seedFixtures(c)
      await actAs(c, restricted)
      let blocked = false
      try {
        await insertAction(c, 'event.record', restricted) // not in firm.paralegal.action_kinds
      } catch {
        blocked = true // RLS WITH CHECK rejects; the tx wrapper's ROLLBACK clears the aborted state
      }
      return { blocked }
    })
    expect(r.blocked).toBe(true)
  })

  it('allows an in-scope action (entity.create)', async () => {
    const ok = await tx(async (c) => {
      const { restricted } = await seedFixtures(c)
      await actAs(c, restricted)
      await insertAction(c, 'entity.create', restricted) // in firm.paralegal.action_kinds
      return true
    })
    expect(ok).toBe(true)
  })

  it('hides out-of-scope entity kinds from a restricted actor but shows in-scope ones', async () => {
    const r = await tx(async (c) => {
      const { restricted, inScope, outScope } = await seedFixtures(c)
      await actAs(c, restricted)
      return { sawIn: await canSee(c, inScope), sawOut: await canSee(c, outScope) }
    })
    expect(r.sawIn).toBe(1)
    expect(r.sawOut).toBe(0)
  })

  it('lets an unrestricted actor (no scopes) see every kind', async () => {
    const r = await tx(async (c) => {
      const { inScope, outScope } = await seedFixtures(c)
      await actAs(c, AGENT) // agent has no scope assignments -> unrestricted
      return { sawIn: await canSee(c, inScope), sawOut: await canSee(c, outScope) }
    })
    expect(r.sawIn).toBe(1)
    expect(r.sawOut).toBe(1)
  })
})
