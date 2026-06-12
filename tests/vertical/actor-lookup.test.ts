// Attorney Google sign-in resolves the actor by email via lookupActorByEmail.
// Regression guard for a wedge→core schema port defect: the query referenced a
// non-existent `email` column on `actor` and threw on EVERY sign-in. A human
// actor's email is its `external_id`. These tests prove the query executes
// (no column error) and resolves/filters correctly.
import { describe, it, expect, afterAll } from 'vitest'
import pg from 'pg'
import { lookupActorByEmail } from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'

run('lookupActorByEmail (live DB)', { timeout: 60_000 }, () => {
  const db = new pg.Pool({ connectionString: url })
  // A disposable human actor we set an external_id (email) on, then clean up.
  const TEST_ACTOR = '00000000-0000-0000-0001-0000000000fe'
  const TEST_EMAIL = `signin-probe-${Date.now()}@example.test`

  afterAll(async () => {
    await db.query(`DELETE FROM actor WHERE id = $1`, [TEST_ACTOR]).catch(() => {})
    await db.end()
    await closeDbPool()
  })

  it('executes without the old missing-column error and returns null for an unknown email', async () => {
    // The defect threw here ("column email does not exist") before the fix.
    expect(await lookupActorByEmail('definitely-not-a-real-actor@nowhere.test')).toBeNull()
  })

  it('does not match a non-human (system) actor by its external_id', async () => {
    // public-intake is a system actor with external_id='public-intake'.
    expect(await lookupActorByEmail('public-intake')).toBeNull()
  })

  it('resolves an active human actor by its external_id (email)', async () => {
    await db.query(
      `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1, $2, 'human', $3, 'Sign-in Probe', 'active')
       ON CONFLICT (id) DO UPDATE SET external_id = EXCLUDED.external_id, status = 'active'`,
      [TEST_ACTOR, TENANT, TEST_EMAIL],
    )
    const resolved = await lookupActorByEmail(TEST_EMAIL.toUpperCase()) // case-insensitive
    expect(resolved).not.toBeNull()
    expect(resolved!.actorId).toBe(TEST_ACTOR)
    expect(resolved!.tenantId).toBe(TENANT)
    expect(resolved!.email).toBe(TEST_EMAIL)
  })
})
