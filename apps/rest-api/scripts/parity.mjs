// REST <-> core parity verification against live exsto-dev. Proves:
//  1. The REST surface is generated from the catalog (path count == exposed tools).
//  2. A REST write produces the IDENTICAL action + tenant-scoped rows as the
//     equivalent in-process MCP/core call (same action_kind, actor, tenant, intent;
//     each spawns one entity row linked by action_id).
//  3. Cross-tenant access is blocked (tenant B cannot read tenant A's entity).
// Run after build, with a privileged DATABASE_URL:
//   DATABASE_URL=... node scripts/parity.mjs
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { withSuperuser, closeDbPool } from '@exsto/shared'
import { findTool } from '@exsto/mcp-tools'
import { hashKey } from '../dist/auth.js'
import { exposedTools } from '../dist/catalog.js'

const TENANT_A = '00000000-0000-0000-0000-000000000001'
const ACTOR_A = '00000000-0000-0000-0001-000000000001'
const TENANT_B = '00000000-0000-0000-00b2-000000000001'
const ACTOR_B = '00000000-0000-0000-00b2-000000000002'
const KEY_A = 'exsto_parity_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const KEY_B = 'exsto_parity_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const PORT = 4101
const BASE = `http://localhost:${PORT}`

function assert(cond, msg) {
  if (!cond) throw new Error('PARITY FAIL: ' + msg)
}

async function setup() {
  await withSuperuser(async (c) => {
    await c.query(
      `INSERT INTO tenant (id, name) VALUES ($1,'Parity Test Tenant B') ON CONFLICT (id) DO NOTHING`,
      [TENANT_B],
    )
    await c.query(
      `INSERT INTO actor (id, tenant_id, actor_type, display_name) VALUES ($1,$2,'system','Parity B System') ON CONFLICT (id) DO NOTHING`,
      [ACTOR_B, TENANT_B],
    )
    for (const [tenant, actor, key] of [
      [TENANT_A, ACTOR_A, KEY_A],
      [TENANT_B, ACTOR_B, KEY_B],
    ]) {
      await c.query(
        `INSERT INTO api_key (tenant_id, actor_id, name, key_prefix, key_hash)
         VALUES ($1,$2,'parity-test',$3,$4)
         ON CONFLICT (key_hash) DO UPDATE SET revoked_at = NULL`,
        [tenant, actor, key.slice(0, 14), hashKey(key)],
      )
    }
  })
}

async function teardown() {
  await withSuperuser((c) =>
    c.query(`UPDATE api_key SET revoked_at = now() WHERE key_hash = ANY($1)`, [
      [hashKey(KEY_A), hashKey(KEY_B)],
    ]),
  ).catch(() => {})
}

async function rest(path, key, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function actionRow(actionId) {
  return withSuperuser(async (c) => {
    const { rows } = await c.query(
      `SELECT a.tenant_id, a.actor_id, a.intent_kind, k.kind_name AS action_kind,
              (SELECT count(*)::int FROM entity e WHERE e.action_id = a.id) AS entity_count,
              (SELECT e.entity_kind_id IS NOT NULL FROM entity e WHERE e.action_id = a.id LIMIT 1) AS has_entity
         FROM action a JOIN action_kind_definition k ON k.id = a.action_kind_id
        WHERE a.id = $1`,
      [actionId],
    )
    return rows[0] ?? null
  })
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  console.log('REST adapter parity (live exsto-dev):')
  await setup()

  const proc = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  try {
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(`${BASE}/health`)).ok) break
      } catch {
        /* wait */
      }
      await sleep(150)
    }

    // 1. Catalog-generated surface.
    const specRes = await fetch(`${BASE}/v1/openapi.json`)
    const spec = await specRes.json()
    const pathCount = Object.keys(spec.paths).length
    const exposed = exposedTools().length
    assert(pathCount === exposed, `OpenAPI paths (${pathCount}) != exposed tools (${exposed})`)
    console.log(`  catalog: ${pathCount} REST paths generated from ${exposed} exposed tools (1:1).`)

    // 2. Write parity: REST vs the equivalent in-process core/MCP call.
    const input = { entityKindName: 'person' }
    const r = await rest('/v1/entity/create', KEY_A, input)
    assert(r.status === 200, `REST entity.create status ${r.status}: ${JSON.stringify(r.json)}`)
    const restActionId = r.json.data.actionId
    const restEntityId = r.json.data.effects[0].entityId

    const core = await findTool('entity.create').handler(
      { tenantId: TENANT_A, actorId: ACTOR_A },
      input,
    )
    const restRow = await actionRow(restActionId)
    const coreRow = await actionRow(core.actionId)
    assert(restRow && coreRow, 'missing action rows')
    assert(
      restRow.action_kind === 'entity.create' && coreRow.action_kind === 'entity.create',
      'action_kind mismatch',
    )
    assert(restRow.tenant_id === TENANT_A && coreRow.tenant_id === TENANT_A, 'tenant mismatch')
    assert(restRow.actor_id === ACTOR_A && coreRow.actor_id === ACTOR_A, 'actor mismatch')
    assert(restRow.intent_kind === coreRow.intent_kind, 'intent mismatch')
    assert(
      restRow.entity_count === 1 && coreRow.entity_count === 1,
      'each action must spawn exactly one entity',
    )
    console.log(
      `  write parity: REST and core both produced action_kind=entity.create, tenant=A, actor=A, intent=${restRow.intent_kind}, 1 entity each — IDENTICAL.`,
    )

    // 3. Cross-tenant isolation.
    const ownRead = await rest('/v1/entity/get', KEY_A, { entityId: restEntityId })
    assert(
      ownRead.status === 200 &&
        ownRead.json.data.entity &&
        ownRead.json.data.entity.id === restEntityId,
      'tenant A should read its own entity',
    )
    const crossRead = await rest('/v1/entity/get', KEY_B, { entityId: restEntityId })
    assert(
      crossRead.status === 200 && crossRead.json.data.entity === null,
      `tenant B must NOT see tenant A entity (got ${JSON.stringify(crossRead.json.data.entity)})`,
    )
    console.log(
      '  cross-tenant: A reads its entity; B reads null for the same id — isolation holds.',
    )

    // 4. Auth + system-op guards.
    const noAuth = await fetch(`${BASE}/v1/entity/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert(noAuth.status === 401, `no-key -> expected 401, got ${noAuth.status}`)
    const systemOp = await rest('/v1/substrate/kind/define', KEY_A, {})
    assert(
      systemOp.status === 404,
      `system op kind.define -> expected 404 (not exposed), got ${systemOp.status}`,
    )
    console.log(
      '  guards: missing key -> 401; system op substrate.kind.define -> 404 (not exposed).',
    )

    console.log('PARITY_OK')
  } finally {
    proc.kill()
    await teardown()
    await closeDbPool()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
