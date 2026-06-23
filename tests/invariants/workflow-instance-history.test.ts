// ADR 0045 PR3 (migration 0093) — BEHAVIORAL test on `workflow_instance`. The
// workflow_instance row is the ADR-0039 exception: its status + current_state mutate
// in place, but its state_history must stay APPEND-ONLY (the audit stream of how the
// matter moved) and its workflow_definition_id must be IMMUTABLE (invariant 17: a
// matter never re-binds to a different definition after it is opened).
//
// Like append-only.test.ts / bitemporal.test.ts, this connects as the privileged
// migration role (DATABASE_URL / SUBSTRATE_TEST_DATABASE_URL) which has BYPASSRLS, so
// the RLS deny policies do not stop it — only the BEFORE UPDATE triggers from
// migration 0093 do. Every probe is wrapped in BEGIN/ROLLBACK so it leaves no rows.
// DB-gated: skipped cleanly without a connection string AND requires migration 0093.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const AK_BOOTSTRAP = '00000000-0000-0000-0013-000000000001'
const ACTOR_SYSTEM = '00000000-0000-0000-0001-000000000001'

run(
  'migration 0093: workflow_instance state_history is append-only + definition is immutable',
  () => {
    let pool: pg.Pool
    beforeAll(() => {
      pool = new pg.Pool({ connectionString: url })
    })
    afterAll(async () => {
      await pool.end()
    })

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

    async function insertDefinition(c: pg.PoolClient, actionId: string): Promise<string> {
      const r = await c.query<{ id: string }>(
        `INSERT INTO workflow_definition (id, tenant_id, action_id, kind_name, display_name, states)
       VALUES (gen_random_uuid(), $1, $2, 'wf_probe_def', 'WF probe', '[]'::jsonb)
       RETURNING id`,
        [TENANT, actionId],
      )
      return r.rows[0]!.id
    }

    // A fresh instance with a two-element state_history (so we can test prefix rules).
    async function insertInstance(c: pg.PoolClient): Promise<string> {
      const actionId = await insertAction(c)
      const defId = await insertDefinition(c, actionId)
      const history = JSON.stringify([
        { state: 'intake_submitted', action_id: actionId, at: '2026-01-01T00:00:00.000Z' },
        { state: 'in_review', from: 'intake_submitted', gate: 'attorney', action_id: actionId },
      ])
      const r = await c.query<{ id: string }>(
        `INSERT INTO workflow_instance
         (id, tenant_id, action_id, workflow_definition_id, current_state, state_history)
       VALUES (gen_random_uuid(), $1, $2, $3, 'in_review', $4::jsonb)
       RETURNING id`,
        [TENANT, actionId, defId, history],
      )
      return r.rows[0]!.id
    }

    it('allows a PURE APPEND to state_history (the engine advance path)', async () => {
      const ok = await inTxn(async (c) => {
        const id = await insertInstance(c)
        try {
          await c.query(
            `UPDATE workflow_instance
              SET current_state = 'approved',
                  state_history = state_history || $2::jsonb
            WHERE id = $1`,
            [id, JSON.stringify({ state: 'approved', from: 'in_review', gate: 'attorney' })],
          )
          return true
        } catch {
          return false
        }
      })
      expect(ok).toBe(true)
    })

    it('rejects TRUNCATING state_history (it may only grow)', async () => {
      const blocked = await inTxn(async (c) => {
        const id = await insertInstance(c)
        try {
          await c.query(
            `UPDATE workflow_instance SET state_history = jsonb_build_array(state_history -> 0) WHERE id = $1`,
            [id],
          )
          return false
        } catch {
          return true
        }
      })
      expect(blocked).toBe(true)
    })

    it('rejects REWRITING an existing state_history element', async () => {
      const blocked = await inTxn(async (c) => {
        const id = await insertInstance(c)
        try {
          // Same length, but element 0 is rewritten — must be a positional prefix.
          await c.query(
            `UPDATE workflow_instance
              SET state_history = jsonb_build_array(
                    jsonb_build_object('state', 'tampered'),
                    state_history -> 1)
            WHERE id = $1`,
            [id],
          )
          return false
        } catch {
          return true
        }
      })
      expect(blocked).toBe(true)
    })

    it('rejects REORDERING state_history (prefix equality breaks)', async () => {
      const blocked = await inTxn(async (c) => {
        const id = await insertInstance(c)
        try {
          await c.query(
            `UPDATE workflow_instance
              SET state_history = jsonb_build_array(state_history -> 1, state_history -> 0)
            WHERE id = $1`,
            [id],
          )
          return false
        } catch {
          return true
        }
      })
      expect(blocked).toBe(true)
    })

    it('rejects changing workflow_definition_id (invariant 17: definition is immutable)', async () => {
      const blocked = await inTxn(async (c) => {
        const id = await insertInstance(c)
        // A second, distinct definition to try to re-bind to.
        const actionId = await insertAction(c)
        const otherDefId = await insertDefinition(c, actionId)
        try {
          await c.query(`UPDATE workflow_instance SET workflow_definition_id = $2 WHERE id = $1`, [
            id,
            otherDefId,
          ])
          return false
        } catch {
          return true
        }
      })
      expect(blocked).toBe(true)
    })
  },
)
