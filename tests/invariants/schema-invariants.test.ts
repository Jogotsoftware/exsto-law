// Structural invariant checks against a live substrate database. These read the
// Postgres catalog, so they are role-independent and assert the invariants are
// *configured* (the schema cannot be deployed without them). DB-gated: set
// SUBSTRATE_TEST_DATABASE_URL (or DATABASE_URL) to run; skipped otherwise.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

// Tables that are append-only (CLAUDE.md hard rule 3): no permissive UPDATE/DELETE.
// migration_job is deliberately NOT here — it is a lifecycle table (ADR 0039),
// status mutates in place; see grants.test.ts for its lifecycle assertions.
const APPEND_ONLY = [
  'action',
  'event',
  'raw_event_log',
  'reasoning_trace',
  'approval_response',
  'communication_message',
  'configuration_change',
  'schema_migration',
  'access_log',
  'causal_claim',
  'fact_contestation',
  'identity_assertion',
  'substrate_capability_metric',
]

run('structural invariants (live DB)', () => {
  let pool: pg.Pool
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  it('invariant 1: every public table has RLS enabled', async () => {
    const { rows } = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('invariant 1: every public table is tenant-scoped (has tenant_id)', async () => {
    // `tenant` is the tenant registry itself — isolated by its own id, not a
    // tenant_id. Every other table must carry tenant_id.
    const { rows } = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> 'tenant'
          AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns col
             WHERE col.table_schema='public' AND col.table_name=c.relname
               AND col.column_name='tenant_id')`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('invariant 14: append-only tables have no permissive UPDATE/DELETE policy', async () => {
    const { rows } = await pool.query(
      `SELECT tablename, cmd, qual FROM pg_policies
        WHERE schemaname='public' AND cmd IN ('UPDATE','DELETE')
          AND tablename = ANY($1) AND coalesce(qual,'') <> 'false'`,
      [APPEND_ONLY],
    )
    expect(rows).toEqual([])
  })

  it('invariant 5/6/7: attribute carries provenance, confidence, knowability', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='attribute'
          AND column_name IN ('source_type','confidence','knowability_state','time_precision')`,
    )
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r.is_nullable]))
    expect(byName.source_type).toBe('NO')
    expect(byName.confidence).toBe('NO')
    expect(byName.knowability_state).toBe('NO')
    expect(byName.time_precision).toBe('NO')
  })

  it('invariant 6: confidence is constrained to [0,1] on fact tables', async () => {
    const { rows } = await pool.query(
      `SELECT conrelid::regclass::text AS tbl FROM pg_constraint
        WHERE contype='c' AND conrelid::regclass::text IN ('attribute','judgment','event','outcome')
          AND pg_get_constraintdef(oid) ILIKE '%confidence%'`,
    )
    const tables = new Set(rows.map((r) => r.tbl))
    for (const t of ['attribute', 'judgment', 'event', 'outcome']) expect(tables.has(t)).toBe(true)
  })

  it('invariant 9: every action carries actor + intent (NOT NULL)', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='action'
          AND column_name IN ('actor_id','intent_kind','autonomy_tier','action_kind_id')`,
    )
    expect(rows.every((r) => r.is_nullable === 'NO')).toBe(true)
    expect(rows.length).toBe(4)
  })
})
