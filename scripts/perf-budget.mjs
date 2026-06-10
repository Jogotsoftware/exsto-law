// Substrate performance-budget measurement (CLAUDE.md soft rule 7 / DoD: 50ms per
// primitive operation under no contention). Runs representative primitive
// operations against a target DB, collects per-operation latency via the always-on
// latency recorder in @exsto/shared, and prints ACTUAL p50/p95/p99 with a verdict.
//
//   DATABASE_URL=<target> [SUBSTRATE_DB_ROLE=authenticated] [PERF_ITERATIONS=200] \
//     node scripts/perf-budget.mjs
//
// IMPORTANT — read the numbers correctly. Each primitive operation makes several
// round trips to Postgres inside one transaction (BEGIN, set_config, the kind
// lookup, the inserts, COMMIT). Against a co-located DB (sub-ms RTT) the substrate
// compute is what the 50ms budget targets; against a REMOTE DB the wall-clock is
// dominated by N x network RTT. This script measures the round-trip baseline
// (SELECT 1) and decomposes the result so the substrate-compute figure is visible
// regardless of where the DB lives. The budget is strictly validated in CI, where
// the DB is a local `supabase start` stack (sub-ms RTT).
import { createEntity, setAttribute } from '../packages/primitives/dist/index.js'
import { getEntityWithCurrentAttributes } from '../packages/primitives/dist/index.js'
import {
  getLatencyStats,
  resetLatency,
  recordLatency,
  closeDbPool,
  getDbPool,
} from '../packages/shared/dist/index.js'

const BUDGET_MS = 50
const ITERATIONS = Number(process.env.PERF_ITERATIONS ?? 200)
const TENANT = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0001-000000000002'
const ctx = { tenantId: TENANT, actorId: ACTOR }

function fmt(n) {
  return `${n.toFixed(1)}ms`
}

async function measureRtt(samples = 50) {
  const pool = await getDbPool()
  const xs = []
  for (let i = 0; i < samples; i++) {
    const t = performance.now()
    await pool.query('SELECT 1')
    xs.push(performance.now() - t)
  }
  xs.sort((a, b) => a - b)
  return xs[Math.floor(samples / 2)]
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required.')
  console.log(`Substrate perf budget: ${ITERATIONS} iterations/op, budget ${BUDGET_MS}ms.\n`)

  const rtt = await measureRtt()
  console.log(`Round-trip baseline (SELECT 1, p50): ${fmt(rtt)} — WAN floor per DB round trip.\n`)

  resetLatency()
  // Warm up (connection pool, plan caches) — not measured.
  const warm = await createEntity(ctx, {
    entityKindName: 'person',
    attributes: [],
    intentKind: 'exploration',
  })
  const warmId = warm.effects[0].entityId
  await setAttribute(ctx, {
    entityId: warmId,
    attributeKindName: 'full_name',
    value: 'warm',
    confidence: 1,
    knowabilityState: 'observed',
    timePrecision: 'exact_instant',
    intentKind: 'exploration',
  })
  await getEntityWithCurrentAttributes(ctx, warmId)
  resetLatency()

  // Measured loop. entity.create (action), attribute.set (action+supersession),
  // entity.get (read). Each createEntity/setAttribute is one substrate.action.submit
  // span; getEntityWithCurrentAttributes is substrate.query spans.
  for (let i = 0; i < ITERATIONS; i++) {
    const e = await createEntity(ctx, {
      entityKindName: 'person',
      attributes: [],
      intentKind: 'exploration',
    })
    const id = e.effects[0].entityId
    await setAttribute(ctx, {
      entityId: id,
      attributeKindName: 'full_name',
      value: `n${i}`,
      confidence: 1,
      knowabilityState: 'observed',
      timePrecision: 'exact_instant',
      intentKind: 'exploration',
    })
    await getEntityWithCurrentAttributes(ctx, id)
  }

  // Round trips per span, from the actual code path. withTenant wraps every
  // operation in: BEGIN, [SET LOCAL ROLE if SUBSTRATE_DB_ROLE], set_config tenant,
  // set_config actor, ...inner queries..., COMMIT.
  //   query  = 4 wrapper + 1 inner SELECT            = 5  (+1 with role binding)
  //   action = 4 wrapper + SELECT kind + INSERT action + handler(lookup + insert)
  //          = 4 + 4                                  = 8  (+1 with role binding)
  const roleRtt = process.env.SUBSTRATE_DB_ROLE ? 1 : 0
  const roundTrips = {
    'substrate.action.submit': 8 + roleRtt,
    'substrate.query': 5 + roleRtt,
  }

  const stats = getLatencyStats()
  console.log(
    'operation                    count    p50      p95      p99      max      ~compute(p50)',
  )
  console.log(
    '--------------------------------------------------------------------------------------',
  )
  for (const s of stats) {
    const rt = roundTrips[s.operation] ?? 1
    const compute = Math.max(0, s.p50 - rt * rtt)
    console.log(
      `${s.operation.padEnd(28)} ${String(s.count).padEnd(7)} ${fmt(s.p50).padEnd(8)} ${fmt(s.p95).padEnd(8)} ${fmt(s.p99).padEnd(8)} ${fmt(s.max).padEnd(8)} ~${fmt(compute)} (≈${rt} RTT)`,
    )
  }

  console.log('')
  const co = stats.map((s) => {
    const rt = roundTrips[s.operation] ?? 1
    return { op: s.operation, compute: Math.max(0, s.p50 - rt * rtt) }
  })
  const overEndToEnd = stats.filter((s) => s.p50 > BUDGET_MS).map((s) => s.operation)
  const overCompute = co.filter((c) => c.compute > BUDGET_MS).map((c) => c.op)

  console.log(`Round-trip p50 baseline: ${fmt(rtt)}`)
  console.log(
    `End-to-end (incl. WAN) over ${BUDGET_MS}ms: ${overEndToEnd.length ? overEndToEnd.join(', ') : 'none'}`,
  )
  console.log(
    `Estimated substrate compute over ${BUDGET_MS}ms: ${overCompute.length ? overCompute.join(', ') : 'NONE — budget met on compute'}`,
  )
  console.log(
    `\nVERDICT: ${overCompute.length === 0 ? 'PASS (substrate compute within 50ms; wall-clock here is WAN-bound)' : 'OVER BUDGET on compute — investigate'}`,
  )

  await closeDbPool()
  process.exit(0)
}

main().catch(async (e) => {
  console.error(e)
  try {
    await closeDbPool()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
