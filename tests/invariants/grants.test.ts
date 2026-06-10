// Invariant 14/1 — privilege-level lockdown. anon must have ZERO write/delete
// grants on any public table; append-only tables must not grant UPDATE/DELETE to
// any app role; bitemporal tables must not grant DELETE. FAILS before the
// lockdown migrations and PASSES after. DB-gated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const APPEND_ONLY = [
  'action',
  'event',
  'raw_event_log',
  'access_log',
  'reasoning_trace',
  'causal_claim',
  'fact_contestation',
  'identity_assertion',
  'configuration_change',
  'schema_migration',
  'approval_response',
  'communication_message',
  'substrate_capability_metric',
]
const BITEMPORAL = [
  'attribute',
  'relationship',
  'judgment',
  'outcome',
  'stakeholder_position',
  'ownership_assignment',
  'hierarchy_membership',
  'actor_scope_assignment',
]
// Operational lifecycle tables (ADR 0039): status mutates in place, so UPDATE is
// granted to the app role — but they still have NO hard-delete path.
const LIFECYCLE = ['worker_job', 'migration_job']

run('invariant 14/1: grant-level lockdown', () => {
  let pool: pg.Pool
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  // Migration 0023: anon has ZERO access to substrate tables (not just no writes).
  // The substrate is reached only through the app as `authenticated`; the public
  // anon role never reads substrate tables directly. Guards adversarial finding A1.
  it('anon has NO privileges of any kind on any public table', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND grantee='anon'`,
    )
    expect(rows).toEqual([])
  })

  it('append-only tables grant no UPDATE/DELETE to any app role', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')
          AND table_name = ANY($1)`,
      [APPEND_ONLY],
    )
    expect(rows).toEqual([])
  })

  it('bitemporal tables grant no DELETE to any app role', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')
          AND privilege_type IN ('DELETE','TRUNCATE')
          AND table_name = ANY($1)`,
      [BITEMPORAL],
    )
    expect(rows).toEqual([])
  })

  // ADR 0039: lifecycle tables mutate status in place, so they DO grant UPDATE to
  // the app role, but they still have no hard-delete path.
  it('lifecycle tables grant UPDATE to authenticated', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT table_name FROM information_schema.role_table_grants
        WHERE table_schema='public' AND grantee='authenticated'
          AND privilege_type='UPDATE' AND table_name = ANY($1)`,
      [LIFECYCLE],
    )
    expect(rows.map((r) => r.table_name).sort()).toEqual([...LIFECYCLE].sort())
  })

  it('lifecycle tables grant no DELETE/TRUNCATE to any app role', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')
          AND privilege_type IN ('DELETE','TRUNCATE')
          AND table_name = ANY($1)`,
      [LIFECYCLE],
    )
    expect(rows).toEqual([])
  })
})
