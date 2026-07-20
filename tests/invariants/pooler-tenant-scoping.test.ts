// B3.3 — pooler tenant-GUC scoping invariant.
//
// The reliability fix points the app DATABASE_URL at Supabase's TRANSACTION-mode
// pooler (port 6543) to stop session-mode backend exhaustion. A transaction-mode
// pooler reassigns one Postgres backend to a DIFFERENT client between transactions,
// so the app is only safe if every tenant GUC is transaction-scoped and never
// persists onto the physical connection past COMMIT. This suite proves exactly
// that, and proves withSuperuser now runs its callback inside one transaction so
// its multi-statement app-tier callbacks stay backend-pinned/atomic.
//
// DB-gated: needs SUBSTRATE_TEST_DATABASE_URL (or DATABASE_URL). Skipped otherwise,
// so it is safe in the no-DB `test:unit` gate and runs for real in CI's invariants
// job (against a live Postgres with migrations + seed applied).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { withTenant, withSuperuser, closeDbPool } from '@exsto/shared'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001' // seeded Exsto Dev tenant
const OTHER = '99999999-9999-9999-9999-999999999999' // a tenant we are not

// Prime env BEFORE the shipped helpers build their (lazy) singleton pool, so Part B
// drives the REAL withTenant/withSuperuser under the production ADR-0037 role with a
// single-connection pool — forcing one physical connection to be reused across
// sequential transactions, the exact pattern a transaction-mode pooler produces.
// vitest forks + isolates each test file, so these mutations do not affect siblings.
if (url) {
  process.env.DATABASE_URL = url
  process.env.SUBSTRATE_DB_ROLE = 'authenticated'
  process.env.DATABASE_POOL_MAX = '1'
}

// Part A — DB-level proof on a raw single-connection pool. max:1 guarantees the
// SAME physical backend is handed back on every checkout, and we hold one client
// for the whole suite, so this is the strongest model of a pooled backend reused
// across tenants. Mirrors rls-enforcement.test.ts's SET LOCAL ROLE discipline.
run('B3.3: tenant GUC scoping survives connection reuse (transaction-pooler safety)', () => {
  let pool: pg.Pool
  let client: pg.PoolClient
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 1 })
    client = await pool.connect()
  })
  afterAll(async () => {
    client.release()
    await pool.end()
  })

  async function txAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE authenticated')
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    try {
      return await fn()
    } finally {
      await client.query('COMMIT')
    }
  }

  it('a committed tenant transaction leaves NO app.tenant_id on the reused connection', async () => {
    await txAsTenant(TENANT, async () => {
      const r = await client.query<{ v: string }>(
        `SELECT current_setting('app.tenant_id', true) AS v`,
      )
      expect(r.rows[0].v).toBe(TENANT) // in-transaction the GUC is bound
    })
    // Same physical connection, now BETWEEN transactions (autocommit). SET LOCAL
    // cleared at COMMIT, so there is nothing to leak into the next tenant a
    // transaction-mode pooler hands this backend to.
    const after = await client.query<{ v: string }>(
      `SELECT current_setting('app.tenant_id', true) AS v`,
    )
    expect(after.rows[0].v).toBe('')
  })

  it('sequential different-tenant transactions on ONE connection never cross tenants', async () => {
    const own = await txAsTenant(TENANT, async () => {
      const r = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM actor`)
      return r.rows[0].n
    })
    const other = await txAsTenant(OTHER, async () => {
      const r = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM actor`)
      return r.rows[0].n
    })
    expect(own).toBeGreaterThan(0) // tenant A sees its own rows
    expect(other).toBe(0) // tenant B, reusing the SAME backend, sees ZERO of A's — no leak
  })
})

// Part B — the same guarantees through the SHIPPED @exsto/shared helpers, under the
// production ADR-0037 role and a reused (DATABASE_POOL_MAX=1) connection.
run('B3.3: shipped db helpers are transaction-pooler-safe', () => {
  afterAll(async () => {
    await closeDbPool()
  })

  it('withTenant scopes each call correctly across a reused pooled connection', async () => {
    const own = await withTenant(TENANT, async (c) => {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM actor`)
      return r.rows[0].n
    })
    const other = await withTenant(OTHER, async (c) => {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM actor`)
      return r.rows[0].n
    })
    expect(own).toBeGreaterThan(0)
    expect(other).toBe(0)
  })

  it('withSuperuser runs its callback inside a single transaction (backend-pinned)', async () => {
    const [a, b] = await withSuperuser(async (c) => {
      const r1 = await c.query<{ x: string }>(`SELECT pg_current_xact_id()::text AS x`)
      const r2 = await c.query<{ x: string }>(`SELECT pg_current_xact_id()::text AS x`)
      return [r1.rows[0].x, r2.rows[0].x]
    })
    // One transaction id across two statements ⟺ one enclosing transaction. In the
    // pre-fix autocommit path these were two transactions (two ids) and, under a
    // transaction-mode pooler, potentially two different backends.
    expect(a).toBe(b)
  })
})
