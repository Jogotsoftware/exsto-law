// Invariant 12 (schema-as-data) for migrations: every applied migration must be
// recorded as queryable data in public.schema_migration, not only in the
// platform's private supabase_migrations ledger. FAILS before migration 0016
// (public.schema_migration empty) and PASSES after (backfilled + synced).
// DB-gated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

run('invariant 12: migration history is queryable data', () => {
  let pool: pg.Pool
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  it('every applied migration has a public.schema_migration row', async () => {
    const { rows } = await pool.query<{ missing: number }>(
      `SELECT count(*)::int AS missing
         FROM supabase_migrations.schema_migrations m
        WHERE NOT EXISTS (
          SELECT 1 FROM public.schema_migration s
           WHERE s.entry_kind = 'migration' AND s.version = m.version)`,
    )
    expect(rows[0]!.missing).toBe(0)
  })

  it('records carry version, name, checksum, applied_at, applied_by', async () => {
    const { rows } = await pool.query<{ bad: number }>(
      `SELECT count(*)::int AS bad FROM public.schema_migration
        WHERE entry_kind = 'migration'
          AND (version IS NULL OR name IS NULL OR checksum IS NULL
               OR applied_at IS NULL OR applied_by IS NULL)`,
    )
    expect(rows[0]!.bad).toBe(0)
  })

  it('has recorded at least the 15 foundation migrations', async () => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.schema_migration WHERE entry_kind = 'migration'`,
    )
    expect(rows[0]!.n).toBeGreaterThanOrEqual(15)
  })
})
