// Invariant 1 (tenancy) — *enforcement* test, not just "policies exist". Assumes
// the built-in non-owner role `authenticated` (RLS applies; no BYPASSRLS) via
// SET LOCAL ROLE inside a transaction, and proves the database isolates tenants
// and rejects cross-tenant writes. DB-gated: needs SUBSTRATE_TEST_DATABASE_URL
// (or DATABASE_URL). Skipped otherwise.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001' // seeded Exsto Dev tenant
const OTHER = '99999999-9999-9999-9999-999999999999' // a tenant we are not

run('invariant 1: RLS enforces tenant isolation for non-owner roles', () => {
  let pool: pg.Pool
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  // Run a callback under role `authenticated` with a bound tenant, in a
  // transaction that is always rolled back.
  async function asTenant<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE authenticated')
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
      const out = await fn(c)
      await c.query('ROLLBACK')
      return out
    } finally {
      c.release()
    }
  }

  it('sees its own tenant rows', async () => {
    const n = await asTenant(TENANT, async (c) => {
      const r = await c.query('SELECT count(*)::int AS n FROM actor')
      return r.rows[0].n as number
    })
    expect(n).toBeGreaterThan(0)
  })

  it('sees zero rows for a tenant it is not', async () => {
    const n = await asTenant(OTHER, async (c) => {
      const r = await c.query('SELECT count(*)::int AS n FROM actor')
      return r.rows[0].n as number
    })
    expect(n).toBe(0)
  })

  it('cannot write a row for another tenant (WITH CHECK)', async () => {
    const rejected = await asTenant(TENANT, async (c) => {
      try {
        await c.query(
          `INSERT INTO actor (tenant_id, actor_type, display_name) VALUES ($1, 'system', 'intruder')`,
          [OTHER], // tenant_id != app.tenant_id -> RLS WITH CHECK must reject
        )
        return false
      } catch {
        return true
      }
    })
    expect(rejected).toBe(true)
  })
})
