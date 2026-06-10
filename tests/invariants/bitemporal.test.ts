// Invariant 14/2 (bitemporal) — BEHAVIORAL test on `attribute`. Closing via
// valid_to is allowed; hard DELETE is rejected; sealed (already-closed) rows are
// immutable; an open row may change ONLY its valid_to. FAILS before migration
// 0018 and PASSES after. DB-gated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const AK_BOOTSTRAP = '00000000-0000-0000-0013-000000000001'
const ACTOR_SYSTEM = '00000000-0000-0000-0001-000000000001'
const ENTITY_KIND_PERSON = '00000000-0000-0000-0010-000000000001'
const ATTR_KIND_STATUS = '00000000-0000-0000-0011-000000000004'

run('invariant 14/2: bitemporal fact tables (attribute)', () => {
  let pool: pg.Pool
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  // Insert action -> entity -> open attribute; return the attribute id.
  async function setupOpenAttribute(c: pg.PoolClient): Promise<string> {
    const a = await c.query<{ id: string }>(
      `INSERT INTO action (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
                           payload, hlc_physical_time, hlc_logical_counter, hlc_source_id)
       VALUES (gen_random_uuid(), $1, $2, $3, 'unknown', 'autonomous', '{}'::jsonb, now(), 0, gen_random_uuid())
       RETURNING id`,
      [TENANT, AK_BOOTSTRAP, ACTOR_SYSTEM],
    )
    const actionId = a.rows[0]!.id
    const e = await c.query<{ id: string }>(
      `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name)
       VALUES (gen_random_uuid(), $1, $2, $3, 'bitemporal-probe') RETURNING id`,
      [TENANT, actionId, ENTITY_KIND_PERSON],
    )
    const entityId = e.rows[0]!.id
    const at = await c.query<{ id: string }>(
      `INSERT INTO attribute (id, tenant_id, action_id, entity_id, attribute_kind_id, value,
                              confidence, knowability_state, time_precision, source_type)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, '"open"'::jsonb, 1, 'observed', 'day', 'system')
       RETURNING id`,
      [TENANT, actionId, entityId, ATTR_KIND_STATUS],
    )
    return at.rows[0]!.id
  }

  async function inTxn<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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

  it('allows the valid_to close of an open row', async () => {
    const ok = await inTxn(async (c) => {
      const id = await setupOpenAttribute(c)
      try {
        await c.query(`UPDATE attribute SET valid_to = now() WHERE id = $1 AND valid_to IS NULL`, [
          id,
        ])
        return true
      } catch {
        return false
      }
    })
    expect(ok).toBe(true)
  })

  it('rejects hard DELETE', async () => {
    const blocked = await inTxn(async (c) => {
      const id = await setupOpenAttribute(c)
      try {
        await c.query(`DELETE FROM attribute WHERE id = $1`, [id])
        return false
      } catch {
        return true
      }
    })
    expect(blocked).toBe(true)
  })

  it('rejects mutation of a sealed (already-closed) row', async () => {
    const blocked = await inTxn(async (c) => {
      const id = await setupOpenAttribute(c)
      await c.query(`UPDATE attribute SET valid_to = now() WHERE id = $1`, [id]) // close (allowed)
      try {
        await c.query(`UPDATE attribute SET value = '"tampered"'::jsonb WHERE id = $1`, [id])
        return false
      } catch {
        return true
      }
    })
    expect(blocked).toBe(true)
  })

  it('rejects changing any column other than valid_to on an open row', async () => {
    const blocked = await inTxn(async (c) => {
      const id = await setupOpenAttribute(c)
      try {
        await c.query(`UPDATE attribute SET value = '"tampered"'::jsonb WHERE id = $1`, [id])
        return false
      } catch {
        return true
      }
    })
    expect(blocked).toBe(true)
  })
})
