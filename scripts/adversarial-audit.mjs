// Adversarial security audit for the Exsto substrate — DB layer.
//
// Actively tries to BREAK the substrate's guarantees as every Postgres role
// (anon, authenticated, service_role) via direct SQL: cross-tenant reads/writes,
// forged tenant binding, append-only UPDATE/DELETE, sealed-row edits, and the
// anon lockdown. Every attempt is logged with its expected vs observed result
// and a PASS (violation blocked) / FAIL (violation succeeded) verdict.
//
// PASS for the whole run = zero successful violations. Any FAIL is a P0.
//
// Adapter-layer attacks (REST + MCP: forged tenant args/headers, idempotency
// abuse, malformed payloads) live in scripts/adversarial-adapters.mjs and run
// against the live servers; this file is the database-enforcement core.
//
//   DATABASE_URL=<owner/postgres url to a DISPOSABLE project> node scripts/adversarial-audit.mjs
//
// Connects as the owner (postgres) ONLY to create fixtures and to SET LOCAL ROLE
// into each non-owner role for the attacks. Never run against production.
import pg from 'pg'
import { createEntity, setAttribute } from '../packages/primitives/dist/index.js'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required (a DISPOSABLE project).')
  process.exit(1)
}

const TENANT_A = '00000000-0000-0000-0000-000000000001'
const ACTOR_A = '00000000-0000-0000-0001-000000000002' // Founder
const TENANT_B = '00000000-0000-0000-0000-000000000002'
const ACTOR_B = '00000000-0000-0000-0002-000000000001' // System B

const pool = new pg.Pool({ connectionString: url })
const results = []

function record(id, attack, role, expected, observed, pass) {
  results.push({ id, attack, role, expected, observed, verdict: pass ? 'PASS' : 'FAIL' })
}

// Run fn under a non-owner role with a bound tenant, always rolled back so the
// attack never persists. Returns whatever fn returns; rethrows DB errors.
async function asRole(role, tenantId, fn) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`SET LOCAL ROLE ${role}`)
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    const out = await fn(c)
    await c.query('ROLLBACK')
    return out
  } catch (e) {
    try {
      await c.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw e
  } finally {
    c.release()
  }
}

// An attack that SHOULD be blocked: pass if it throws (denied) or returns the
// safe sentinel; fail if it completes the forbidden action.
async function expectBlocked(id, attack, role, tenantId, fn) {
  try {
    const observed = await asRole(role, tenantId, fn)
    if (observed && observed.blocked) {
      record(id, attack, role, 'blocked', observed.detail ?? 'blocked', true)
    } else {
      record(id, attack, role, 'blocked', `SUCCEEDED: ${JSON.stringify(observed)}`, false)
    }
  } catch (e) {
    record(id, attack, role, 'blocked', `denied: ${shortErr(e)}`, true)
  }
}

function shortErr(e) {
  return (e?.message ?? String(e)).split('\n')[0].slice(0, 120)
}

async function main() {
  // --- Fixtures (as owner; legitimate seeding) -----------------------------
  // A real entity + a superseded (sealed) attribute in tenant A, plus an action.
  const ctxA = { tenantId: TENANT_A, actorId: ACTOR_A }
  const entity = await createEntity(ctxA, {
    entityKindName: 'person',
    attributes: [],
    intentKind: 'exploration',
  })
  const entityId = entity.effects?.[0]?.entityId ?? entity.effects?.[0]?.entity_id
  // Two attribute versions -> the first is sealed (valid_to set) by supersession.
  await setAttribute(ctxA, {
    entityId,
    attributeKindName: 'full_name',
    value: 'v1',
    confidence: 1,
    knowabilityState: 'observed',
    timePrecision: 'exact_instant',
    intentKind: 'exploration',
  })
  await setAttribute(ctxA, {
    entityId,
    attributeKindName: 'full_name',
    value: 'v2',
    confidence: 1,
    knowabilityState: 'observed',
    timePrecision: 'exact_instant',
    intentKind: 'correction',
  })

  // Capture ids of: a sealed attribute row, an open attribute row, an action row.
  const ids = await pool.query(
    `SELECT
       (SELECT id FROM attribute WHERE entity_id=$1 AND valid_to IS NOT NULL ORDER BY valid_from LIMIT 1) AS sealed_attr,
       (SELECT id FROM attribute WHERE entity_id=$1 AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1) AS open_attr,
       (SELECT id FROM action WHERE tenant_id=$2 ORDER BY recorded_at DESC LIMIT 1) AS action_id`,
    [entityId, TENANT_A],
  )
  const { sealed_attr, open_attr, action_id } = ids.rows[0]

  // === ATTACKS =============================================================

  // --- anon: should see nothing and write nothing (migration 0019) ---------
  {
    const r = await asRole('anon', TENANT_A, async (c) => {
      try {
        const q = await c.query('SELECT count(*)::int AS n FROM actor')
        return { read: q.rows[0].n }
      } catch (e) {
        return { read: `denied: ${shortErr(e)}` }
      }
    })
    const safe = r.read === 0 || String(r.read).startsWith('denied')
    record(
      'A1',
      'anon SELECT actor (tenant A bound)',
      'anon',
      '0 rows or denied',
      String(r.read),
      safe,
    )
  }
  await expectBlocked('A2', 'anon INSERT actor', 'anon', TENANT_A, async (c) => {
    await c.query(
      `INSERT INTO actor (tenant_id, actor_type, display_name) VALUES ($1,'system','anon-intruder')`,
      [TENANT_A],
    )
    return { blocked: false }
  })

  // --- authenticated: sees own tenant, not others -------------------------
  {
    const n = await asRole('authenticated', TENANT_A, async (c) => {
      const q = await c.query('SELECT count(*)::int AS n FROM actor')
      return q.rows[0].n
    })
    record(
      'A3',
      'authenticated SELECT own-tenant actors',
      'authenticated',
      '>0 (own only)',
      String(n),
      n > 0,
    )
  }
  {
    // Cross-tenant read: bound to A, try to read B's specific actor by id.
    const n = await asRole('authenticated', TENANT_A, async (c) => {
      const q = await c.query('SELECT count(*)::int AS n FROM actor WHERE id=$1', [ACTOR_B])
      return q.rows[0].n
    })
    record(
      'A4',
      'authenticated(A) read B actor by id (cross-tenant)',
      'authenticated',
      '0 rows',
      String(n),
      n === 0,
    )
  }
  await expectBlocked(
    'A5',
    'authenticated(A) INSERT actor for tenant B (WITH CHECK)',
    'authenticated',
    TENANT_A,
    async (c) => {
      await c.query(
        `INSERT INTO actor (tenant_id, actor_type, display_name) VALUES ($1,'system','cross-tenant')`,
        [TENANT_B],
      )
      return { blocked: false }
    },
  )

  // --- append-only enforcement (triggers fire for every role) -------------
  await expectBlocked(
    'A6',
    'authenticated UPDATE action (append-only)',
    'authenticated',
    TENANT_A,
    async (c) => {
      await c.query(`UPDATE action SET intent_kind='override' WHERE id=$1`, [action_id])
      return { blocked: false }
    },
  )
  await expectBlocked(
    'A7',
    'authenticated DELETE action (append-only)',
    'authenticated',
    TENANT_A,
    async (c) => {
      await c.query(`DELETE FROM action WHERE id=$1`, [action_id])
      return { blocked: false }
    },
  )

  // --- bitemporal seal: cannot mutate a sealed (valid_to set) fact ---------
  await expectBlocked(
    'A8',
    'authenticated UPDATE sealed attribute value',
    'authenticated',
    TENANT_A,
    async (c) => {
      await c.query(`UPDATE attribute SET value='"tampered"'::jsonb WHERE id=$1`, [sealed_attr])
      return { blocked: false }
    },
  )
  await expectBlocked(
    'A9',
    'authenticated re-open sealed attribute (clear valid_to)',
    'authenticated',
    TENANT_A,
    async (c) => {
      await c.query(`UPDATE attribute SET valid_to=NULL WHERE id=$1`, [sealed_attr])
      return { blocked: false }
    },
  )
  await expectBlocked(
    'A10',
    'authenticated DELETE attribute (no-delete guard)',
    'authenticated',
    TENANT_A,
    async (c) => {
      await c.query(`DELETE FROM attribute WHERE id=$1`, [open_attr])
      return { blocked: false }
    },
  )

  // --- api_key table: sensitive, anon fully locked, tenant-isolated --------
  {
    const r = await asRole('anon', TENANT_A, async (c) => {
      try {
        const q = await c.query('SELECT count(*)::int AS n FROM api_key')
        return `${q.rows[0].n} rows`
      } catch (e) {
        return `denied: ${shortErr(e)}`
      }
    })
    record(
      'A11',
      'anon SELECT api_key',
      'anon',
      'denied (no grant)',
      r,
      String(r).startsWith('denied'),
    )
  }

  // --- service_role: BYPASSRLS is EXPECTED (documented). We assert the two
  //     things that MUST still hold even for it: append-only is not bypassable,
  //     and we separately prove (in code grep) the app never uses service_role.
  {
    const n = await asRole('service_role', null, async (c) => {
      const q = await c.query('SELECT count(DISTINCT tenant_id)::int AS n FROM actor')
      return q.rows[0].n
    })
    // service_role sees all tenants — this is expected bypass, NOT a violation.
    record(
      'A12',
      'service_role sees all tenants (EXPECTED bypass)',
      'service_role',
      '>=2 (bypass by design)',
      String(n),
      n >= 2,
    )
  }
  await expectBlocked(
    'A13',
    'service_role UPDATE action (append-only still holds)',
    'service_role',
    null,
    async (c) => {
      await c.query(`UPDATE action SET intent_kind='override' WHERE id=$1`, [action_id])
      return { blocked: false }
    },
  )

  // --- forged-tenant binding at the DB layer: a client cannot pick a tenant
  //     because the adapter sets app.tenant_id from the principal, never args.
  //     Here we prove that BINDING B and reading shows only B (no leakage of A).
  {
    const leaked = await asRole('authenticated', TENANT_B, async (c) => {
      const q = await c.query('SELECT count(*)::int AS n FROM actor WHERE tenant_id=$1', [TENANT_A])
      return q.rows[0].n
    })
    record(
      'A14',
      'authenticated bound to B cannot read A rows',
      'authenticated',
      '0 rows',
      String(leaked),
      leaked === 0,
    )
  }

  // --- output --------------------------------------------------------------
  const fails = results.filter((r) => r.verdict === 'FAIL')
  console.log('\n=== ADVERSARIAL DB AUDIT RESULTS ===\n')
  for (const r of results) {
    console.log(
      `[${r.verdict}] ${r.id} (${r.role}) ${r.attack}\n        expected: ${r.expected} | observed: ${r.observed}`,
    )
  }
  console.log(`\n${results.length} attacks, ${fails.length} FAIL (successful violations).`)
  console.log('JSON_RESULTS_BEGIN')
  console.log(JSON.stringify(results, null, 2))
  console.log('JSON_RESULTS_END')
  await pool.end()
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('Harness error:', e)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(2)
})
