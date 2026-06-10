// Invariant 14 (append-only) — BEHAVIORAL test. Connects as the privileged
// migration role (DATABASE_URL / SUBSTRATE_TEST_DATABASE_URL) and actually
// attempts UPDATE and DELETE on append-only rows. Because that role has
// BYPASSRLS, the RLS deny policies do not stop it — only the blocking triggers
// do. So this test FAILS before migration 0017 and PASSES after.
// DB-gated: skipped without a connection string.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const AK_BOOTSTRAP = '00000000-0000-0000-0013-000000000001'
const ACTOR_SYSTEM = '00000000-0000-0000-0001-000000000001'
const EK_OBSERVATION = '00000000-0000-0000-0014-000000000001'

run('invariant 14: append-only tables reject UPDATE and DELETE', () => {
  let pool: pg.Pool
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  async function insertAction(c: pg.PoolClient): Promise<string> {
    const r = await c.query<{ id: string }>(
      `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                           payload, hlc_physical_time, hlc_logical_counter, hlc_source_id)
       VALUES (gen_random_uuid(), $1, $2, $3, 'unknown', 'autonomous', '{}'::jsonb, now(), 0, gen_random_uuid())
       RETURNING id`,
      [TENANT, AK_BOOTSTRAP, ACTOR_SYSTEM],
    )
    return r.rows[0]!.id
  }

  async function insertEvent(c: pg.PoolClient): Promise<string> {
    const actionId = await insertAction(c)
    const r = await c.query<{ id: string }>(
      `INSERT INTO event (id, tenant_id, action_id, event_kind_id, payload, source_type,
                          occurred_at, hlc_physical_time, hlc_logical_counter, hlc_source_id)
       VALUES (gen_random_uuid(), $1, $2, $3, '{}'::jsonb, 'system', now(), now(), 0, gen_random_uuid())
       RETURNING id`,
      [TENANT, actionId, EK_OBSERVATION],
    )
    return r.rows[0]!.id
  }

  // Insert a throwaway row, attempt the mutation, roll everything back. Returns
  // whether the mutation was rejected by the database.
  async function mutationBlocked(
    table: 'action' | 'event',
    op: 'update' | 'delete',
  ): Promise<boolean> {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      const id = table === 'action' ? await insertAction(c) : await insertEvent(c)
      const sql =
        op === 'update'
          ? `UPDATE ${table} SET recorded_at = now() WHERE id = $1`
          : `DELETE FROM ${table} WHERE id = $1`
      let blocked = false
      try {
        await c.query(sql, [id])
      } catch {
        blocked = true
      }
      await c.query('ROLLBACK')
      return blocked
    } finally {
      c.release()
    }
  }

  it('action rejects UPDATE', async () =>
    expect(await mutationBlocked('action', 'update')).toBe(true))
  it('action rejects DELETE', async () =>
    expect(await mutationBlocked('action', 'delete')).toBe(true))
  it('event rejects UPDATE', async () =>
    expect(await mutationBlocked('event', 'update')).toBe(true))
  it('event rejects DELETE', async () =>
    expect(await mutationBlocked('event', 'delete')).toBe(true))
})
