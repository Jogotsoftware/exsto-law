// S9 invariant — the RBAC ROLE LADDER enforced in Postgres (migrations 0073 +
// 0078), not just "policies exist". Under the non-owner `authenticated` role
// (RLS applies), this proves the security-critical properties of the ladder:
//
//   P1  a HUMAN with no scope can do nothing (no zero-scope self-grant), while a
//       non-human actor (agent) with no scope stays unrestricted (jobs/seed work)
//   floor  an attorney (a wildcard scope) is still BLOCKED from the escalation
//          actions (legal.user.*), which require an admin scope; an admin is not
//   billing  a paralegal gets every practice action via the wildcard EXCEPT the
//            `!`-excluded billing ones, and cannot read invoice entities
//   practice  the P2a fix — a paralegal CAN open a matter (matter.open), which
//             the old hand-listed firm.paralegal scope wrongly forbade
//
// Self-contained: every fixture is created in a rolled-back transaction using
// the seeded ladder scopes + CORE seed kinds. DB-gated: needs
// SUBSTRATE_TEST_DATABASE_URL (or DATABASE_URL) with migrations through 0078.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const AGENT = '00000000-0000-0000-0001-000000000004' // seeded agent actor, no scopes -> unrestricted

run('invariant: RBAC role ladder enforcement (migrations 0073 + 0078)', () => {
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

  const oneId = (c: pg.PoolClient, table: string, name: string) =>
    c
      .query<{
        id: string
      }>(`SELECT id FROM ${table} WHERE tenant_id=$1 AND kind_name=$2 LIMIT 1`, [TENANT, name])
      .then((r) => r.rows[0].id)

  const scopeId = (c: pg.PoolClient, scopeName: string) =>
    c
      .query<{ id: string }>(
        `SELECT id FROM permission_scope_definition
          WHERE tenant_id=$1 AND scope_name=$2 AND (valid_to IS NULL OR valid_to>now()) LIMIT 1`,
        [TENANT, scopeName],
      )
      .then((r) => r.rows[0].id)

  // Create a human actor (optionally bound to a named ladder scope) plus two
  // fixture entities — a person and an invoice — created as the base role
  // (bypasses RLS). All id lookups happen here, before we drop to `authenticated`.
  async function seed(c: pg.PoolClient, opts: { scope?: string } = {}) {
    const human = randomUUID()
    await c.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1,$2,'human',$3,'RBAC fixture','active')`,
      [human, TENANT, `rbac-${human}@test.local`],
    )

    if (opts.scope) {
      const assignAction = randomUUID()
      await c.query(
        `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                             hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
         VALUES ($1,$2,$3,$4,'enforcement','autonomous',now(),0,$4,'{}'::jsonb)`,
        [
          assignAction,
          TENANT,
          await oneId(c, 'action_kind_definition', 'actor_scope.assign'),
          AGENT,
        ],
      )
      await c.query(
        `INSERT INTO actor_scope_assignment (id, tenant_id, action_id, actor_id, permission_scope_definition_id)
         VALUES (gen_random_uuid(),$1,$2,$3,$4)`,
        [TENANT, assignAction, human, await scopeId(c, opts.scope)],
      )
    }

    const entAction = randomUUID()
    await c.query(
      `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                           hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
       VALUES ($1,$2,$3,$4,'exploration','autonomous',now(),0,$4,'{}'::jsonb)`,
      [entAction, TENANT, await oneId(c, 'action_kind_definition', 'entity.create'), AGENT],
    )
    const person = randomUUID()
    const invoice = randomUUID()
    await c.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1,$2,$3,$4,'fixture person','active','{}'::jsonb)`,
      [person, TENANT, entAction, await oneId(c, 'entity_kind_definition', 'person')],
    )
    await c.query(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
       VALUES ($1,$2,$3,$4,'fixture invoice','active','{}'::jsonb)`,
      [invoice, TENANT, entAction, await oneId(c, 'entity_kind_definition', 'invoice')],
    )

    // Resolve action-kind ids we'll exercise (before dropping privileges).
    const kinds = {
      entityCreate: await oneId(c, 'action_kind_definition', 'entity.create'),
      matterOpen: await oneId(c, 'action_kind_definition', 'matter.open'),
      invoiceIssue: await oneId(c, 'action_kind_definition', 'invoice.issue'),
      assignRole: await oneId(c, 'action_kind_definition', 'legal.user.assign_role'),
      kindDefine: await oneId(c, 'action_kind_definition', 'kind.define'), // %.define floor
    }
    return { human, person, invoice, kinds }
  }

  async function actAs(c: pg.PoolClient, actorId: string): Promise<void> {
    await c.query('SET LOCAL ROLE authenticated')
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT])
    await c.query(`SELECT set_config('app.actor_id', $1, true)`, [actorId])
  }

  // Try an action as the current actor; returns true if RLS WITH CHECK allowed it.
  async function tryAction(c: pg.PoolClient, kindId: string, actorId: string): Promise<boolean> {
    await c.query('SAVEPOINT sp')
    try {
      await c.query(
        `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                             hlc_physical_time, hlc_logical_counter, hlc_source_id, payload)
         VALUES (gen_random_uuid(),$1,$2,$3,'exploration','autonomous',now(),0,$3,'{}'::jsonb)`,
        [TENANT, kindId, actorId],
      )
      return true
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT sp')
      return false
    }
  }

  const canSee = (c: pg.PoolClient, id: string) =>
    c
      .query<{ n: number }>(`SELECT count(*)::int AS n FROM entity WHERE id=$1`, [id])
      .then((r) => r.rows[0].n)

  it('P1: a human with NO scope can neither act nor read', async () => {
    const r = await tx(async (c) => {
      const { human, person, kinds } = await seed(c) // no scope
      await actAs(c, human)
      return {
        acted: await tryAction(c, kinds.entityCreate, human),
        sawPerson: await canSee(c, person),
      }
    })
    expect(r.acted).toBe(false)
    expect(r.sawPerson).toBe(0)
  })

  it('a non-human (agent) with no scope stays unrestricted', async () => {
    const r = await tx(async (c) => {
      const { person, invoice, kinds } = await seed(c)
      await actAs(c, AGENT)
      return {
        acted: await tryAction(c, kinds.entityCreate, AGENT),
        sawPerson: await canSee(c, person),
        sawInvoice: await canSee(c, invoice),
      }
    })
    expect(r.acted).toBe(true)
    expect(r.sawPerson).toBe(1)
    expect(r.sawInvoice).toBe(1)
  })

  it('paralegal: practice yes (entity.create, matter.open) + full read; billing & governance writes no', async () => {
    const r = await tx(async (c) => {
      const { human, person, invoice, kinds } = await seed(c, { scope: 'firm.paralegal' })
      await actAs(c, human)
      return {
        create: await tryAction(c, kinds.entityCreate, human),
        matter: await tryAction(c, kinds.matterOpen, human), // P2a: must be allowed now
        invoice: await tryAction(c, kinds.invoiceIssue, human), // !-excluded -> blocked
        kindDefine: await tryAction(c, kinds.kindDefine, human), // floor -> blocked
        sawPerson: await canSee(c, person),
        sawInvoice: await canSee(c, invoice), // full practice read (no billing-read gate)
      }
    })
    expect(r.create).toBe(true)
    expect(r.matter).toBe(true)
    expect(r.invoice).toBe(false)
    expect(r.kindDefine).toBe(false)
    expect(r.sawPerson).toBe(1)
    expect(r.sawInvoice).toBe(1)
  })

  it('attorney: can bill, but the escalation floor blocks user mgmt AND governance defines', async () => {
    const r = await tx(async (c) => {
      const { human, kinds } = await seed(c, { scope: 'firm.attorney' })
      await actAs(c, human)
      return {
        invoice: await tryAction(c, kinds.invoiceIssue, human), // attorney bills
        assignRole: await tryAction(c, kinds.assignRole, human), // floor: admin-only
        kindDefine: await tryAction(c, kinds.kindDefine, human), // %.define floor: admin-only
      }
    })
    expect(r.invoice).toBe(true)
    expect(r.assignRole).toBe(false)
    expect(r.kindDefine).toBe(false)
  })

  it('admin & super_admin pass the escalation floor (user mgmt + governance defines)', async () => {
    const r = await tx(async (c) => {
      const admin = await seed(c, { scope: 'firm.admin' })
      await actAs(c, admin.human)
      const adminOut = {
        assignRole: await tryAction(c, admin.kinds.assignRole, admin.human),
        kindDefine: await tryAction(c, admin.kinds.kindDefine, admin.human),
      }
      return { adminOut }
    })
    expect(r.adminOut.assignRole).toBe(true)
    expect(r.adminOut.kindDefine).toBe(true)

    const s = await tx(async (c) => {
      const sa = await seed(c, { scope: 'firm.super_admin' })
      await actAs(c, sa.human)
      return { assignRole: await tryAction(c, sa.kinds.assignRole, sa.human) }
    })
    expect(s.assignRole).toBe(true)
  })
})
