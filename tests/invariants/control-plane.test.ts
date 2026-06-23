// ADR 0046 — platform control plane. DB-gated behavioral + guard tests:
//   - the cross-tenant private.cp_* functions return data ONLY to a platform admin
//     (the tenancy guard: a firm actor must see zero tenants);
//   - control_plane_action is append-only (the 0017 trigger blocks UPDATE/DELETE
//     even for the BYPASSRLS test/migration role, not just the RLS-subject app role);
//   - the `tenant` table gains NO broad cross-tenant policy (still self-select only);
//   - the four new control-plane tables all have RLS enabled.
// Skipped without a connection string. Assumes the vertical migrations (0095–0100)
// + seed are applied — i.e. the platform admin (0096) is present.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const PLATFORM_TENANT = '00000000-0000-0000-00FF-000000000001'
const PLATFORM_ADMIN_ACTOR = '00000000-0000-0000-00FF-00000000000a' // seeded by 0096
const NON_ADMIN_ACTOR = '00000000-0000-0000-0001-000000000001' // tenant zero's system actor (not a platform admin)

run('ADR 0046: platform control plane', () => {
  let pool: pg.Pool
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  it('is_platform_admin: true for the seeded platform admin, false for a firm actor', async () => {
    const a = await pool.query<{ ok: boolean }>('SELECT private.is_platform_admin($1) AS ok', [
      PLATFORM_ADMIN_ACTOR,
    ])
    const b = await pool.query<{ ok: boolean }>('SELECT private.is_platform_admin($1) AS ok', [
      NON_ADMIN_ACTOR,
    ])
    expect(a.rows[0]!.ok).toBe(true)
    expect(b.rows[0]!.ok).toBe(false)
  })

  it('cp_list_tenants: a non-admin sees ZERO tenants; the platform admin sees the registry', async () => {
    const none = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM private.cp_list_tenants($1)',
      [NON_ADMIN_ACTOR],
    )
    const all = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM private.cp_list_tenants($1)',
      [PLATFORM_ADMIN_ACTOR],
    )
    expect(none.rows[0]!.n).toBe(0)
    expect(all.rows[0]!.n).toBeGreaterThan(0)
  })

  it('cp_resolve_admin_by_email resolves the seeded admin actor', async () => {
    const r = await pool.query<{ id: string }>(
      'SELECT actor_id::text AS id FROM private.cp_resolve_admin_by_email($1)',
      ['joe@revenueinstruments.com'],
    )
    expect(r.rows[0]?.id?.toLowerCase()).toBe(PLATFORM_ADMIN_ACTOR.toLowerCase())
  })

  // Insert a throwaway audit row (as the BYPASSRLS test role), attempt the
  // mutation, roll everything back. Returns whether the DB rejected the mutation.
  async function cpaMutationBlocked(op: 'update' | 'delete'): Promise<boolean> {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      const ins = await c.query<{ id: string }>(
        `INSERT INTO control_plane_action (id, tenant_id, platform_actor_id, operation, payload)
         VALUES (gen_random_uuid(), $1, $2, 'test.probe', '{}'::jsonb) RETURNING id`,
        [PLATFORM_TENANT, PLATFORM_ADMIN_ACTOR],
      )
      const id = ins.rows[0]!.id
      const sql =
        op === 'update'
          ? `UPDATE control_plane_action SET operation = 'x' WHERE id = $1`
          : `DELETE FROM control_plane_action WHERE id = $1`
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

  it('control_plane_action rejects UPDATE (append-only)', async () =>
    expect(await cpaMutationBlocked('update')).toBe(true))
  it('control_plane_action rejects DELETE (append-only)', async () =>
    expect(await cpaMutationBlocked('delete')).toBe(true))

  it('the tenant table has no broad cross-tenant policy (still self-select only)', async () => {
    const r = await pool.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'tenant' ORDER BY policyname`,
    )
    expect(r.rows.map((x) => x.policyname)).toEqual(['tenant_self_select'])
  })

  it('the four new control-plane tables all have RLS enabled', async () => {
    const r = await pool.query<{ ok: boolean }>(
      `SELECT bool_and(relrowsecurity) AS ok FROM pg_class
        WHERE relname IN ('platform_admin','control_plane_action','module_definition','module_enablement')`,
    )
    expect(r.rows[0]!.ok).toBe(true)
  })
})
