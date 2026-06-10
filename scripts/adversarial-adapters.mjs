// Adversarial security audit — adapter layer (REST + MCP).
//
// Attacks the two adapters as a hostile client: forged tenant in the request body
// / tool args, malformed payloads, idempotency-replay abuse, rate-limit flooding,
// and missing / malformed MCP principal headers. Complements the DB-layer audit
// (scripts/adversarial-audit.mjs). Run with the adapters bound to the non-owner
// app role so RLS is genuinely engaged end-to-end:
//
//   DATABASE_URL=<disposable> SUBSTRATE_DB_ROLE=authenticated node scripts/adversarial-adapters.mjs
//
// PASS for the whole run = zero successful violations. Any FAIL is a P0.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { withSuperuser, closeDbPool } from '../packages/shared/dist/index.js'
import { hashKey } from '../apps/rest-api/dist/auth.js'

// The MCP SDK lives under apps/mcp-server (pnpm, not hoisted to root). Resolve it
// from there so this root-level script can drive a real MCP client.
const reqFromMcp = createRequire(new URL('../apps/mcp-server/package.json', import.meta.url))
const importFromMcp = (subpath) => import(pathToFileURL(reqFromMcp.resolve(subpath)).href)
const { Client } = await importFromMcp('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = await importFromMcp(
  '@modelcontextprotocol/sdk/client/streamableHttp.js',
)

const TENANT_A = '00000000-0000-0000-0000-000000000001'
const ACTOR_A = '00000000-0000-0000-0001-000000000002'
const TENANT_B = '00000000-0000-0000-0000-000000000002'
const ACTOR_B = '00000000-0000-0000-0002-000000000001'
const KEY_A = 'exsto_adv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const KEY_B = 'exsto_adv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const REST_PORT = 4181
const MCP_PORT = 4182
const REST = `http://localhost:${REST_PORT}`

const results = []
function record(id, attack, surface, expected, observed, pass) {
  results.push({ id, attack, surface, expected, observed, verdict: pass ? 'PASS' : 'FAIL' })
}

async function setup() {
  await withSuperuser(async (c) => {
    for (const [tenant, actor, key] of [
      [TENANT_A, ACTOR_A, KEY_A],
      [TENANT_B, ACTOR_B, KEY_B],
    ]) {
      await c.query(
        `INSERT INTO api_key (tenant_id, actor_id, name, key_prefix, key_hash)
         VALUES ($1,$2,'adversarial',$3,$4)
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

async function waitHealth(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* wait */
    }
    await sleep(150)
  }
  throw new Error('server not healthy: ' + url)
}

async function rest(path, key, body, headers = {}, rawBody) {
  const res = await fetch(`${REST}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: rawBody ?? JSON.stringify(body ?? {}),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json }
}

async function entityTenant(entityId) {
  return withSuperuser(async (c) => {
    const { rows } = await c.query(`SELECT tenant_id FROM entity WHERE id=$1`, [entityId])
    return rows[0]?.tenant_id ?? null
  })
}

async function runRestAttacks() {
  // R1: forged tenant in body — must be ignored; entity created under KEY_A's tenant.
  {
    const r = await rest('/v1/entity/create', KEY_A, {
      entityKindName: 'person',
      tenant_id: TENANT_B,
      tenantId: TENANT_B,
      actorId: ACTOR_B,
    })
    const eid = r.json?.data?.effects?.[0]?.entityId
    const owner = eid ? await entityTenant(eid) : null
    record(
      'R1',
      'REST forged tenant_id/actorId in body',
      'REST',
      `created under A (${TENANT_A})`,
      `status=${r.status} owner=${owner}`,
      r.status === 200 && owner === TENANT_A,
    )
  }
  // R2: malformed JSON -> 400.
  {
    const r = await rest('/v1/entity/create', KEY_A, null, {}, '{not valid json')
    record('R2', 'REST malformed JSON body', 'REST', '400', String(r.status), r.status === 400)
  }
  // R3: non-object JSON body -> 400.
  {
    const r = await rest('/v1/entity/create', KEY_A, null, {}, '[1,2,3]')
    record('R3', 'REST non-object JSON body', 'REST', '400', String(r.status), r.status === 400)
  }
  // R4: invalid API key -> 401.
  {
    const r = await rest('/v1/entity/create', 'exsto_not_a_real_key', { entityKindName: 'person' })
    record('R4', 'REST invalid API key', 'REST', '401', String(r.status), r.status === 401)
  }
  // R5: idempotency replay — same key+body twice returns the SAME action and creates ONE entity.
  {
    const key = 'idem-replay-' + ACTOR_A.slice(-6)
    const h = { 'idempotency-key': key }
    const r1 = await rest('/v1/entity/create', KEY_A, { entityKindName: 'person' }, h)
    const r2 = await rest('/v1/entity/create', KEY_A, { entityKindName: 'person' }, h)
    const a1 = r1.json?.data?.actionId
    const a2 = r2.json?.data?.actionId
    record(
      'R5',
      'REST idempotency replay (same key+body)',
      'REST',
      'same actionId both calls',
      `a1=${a1} a2=${a2} same=${a1 === a2}`,
      !!a1 && a1 === a2,
    )
  }
  // R6: idempotency abuse — same key, DIFFERENT body -> 422 (not the cached response).
  {
    const key = 'idem-abuse-' + ACTOR_A.slice(-6)
    const h = { 'idempotency-key': key }
    await rest('/v1/entity/create', KEY_A, { entityKindName: 'person' }, h)
    const r2 = await rest('/v1/entity/create', KEY_A, { entityKindName: 'organization' }, h)
    record(
      'R6',
      'REST idempotency key reuse, different body',
      'REST',
      '422',
      String(r2.status),
      r2.status === 422,
    )
  }
  // R7: rate limit — flood beyond REST_RATE_MAX on tenant B's own window (so the
  // functional attacks above on A are unaffected) -> a 429 appears.
  {
    let got429 = false
    for (let i = 0; i < 30; i++) {
      const r = await rest('/v1/entity/get', KEY_B, { entityId: TENANT_B })
      if (r.status === 429) {
        got429 = true
        break
      }
    }
    record(
      'R7',
      'REST rate-limit flood (tenant B window)',
      'REST',
      '429 seen',
      got429 ? '429 seen' : 'no 429',
      got429,
    )
  }
}

async function mcpClient(tenant, actor) {
  const client = new Client({ name: 'adv', version: '0.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${MCP_PORT}/mcp`), {
    requestInit: { headers: { 'x-tenant-id': tenant, 'x-actor-id': actor } },
  })
  await client.connect(transport)
  return client
}

async function runMcpAttacks() {
  // M1: missing principal headers -> 401 (before any MCP processing).
  {
    const r = await fetch(`http://localhost:${MCP_PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    record(
      'M1',
      'MCP missing tenant/actor headers',
      'MCP',
      '401',
      String(r.status),
      r.status === 401,
    )
  }
  // M2: malformed (non-UUID) headers -> 401.
  {
    const r = await fetch(`http://localhost:${MCP_PORT}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-tenant-id': 'not-a-uuid',
        'x-actor-id': 'nope',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    record(
      'M2',
      'MCP malformed (non-UUID) headers',
      'MCP',
      '401',
      String(r.status),
      r.status === 401,
    )
  }
  // M3: forged tenant in tool ARGS is ignored — entity lands under the HEADER tenant.
  {
    const client = await mcpClient(TENANT_A, ACTOR_A)
    try {
      const res = await client.callTool({
        name: 'entity.create',
        arguments: {
          entityKindName: 'person',
          tenantId: TENANT_B,
          tenant_id: TENANT_B,
          actorId: ACTOR_B,
        },
      })
      const text = res?.content?.find((c) => c.type === 'text')?.text ?? '{}'
      const parsed = JSON.parse(text)
      const eid = parsed?.effects?.[0]?.entityId
      const owner = eid ? await entityTenant(eid) : null
      record(
        'M3',
        'MCP forged tenant in tool args',
        'MCP',
        `created under header tenant A`,
        `owner=${owner}`,
        owner === TENANT_A,
      )
    } finally {
      await client.close()
    }
  }
  // M4: cross-tenant read — B (header) cannot read an entity created by A.
  {
    const ca = await mcpClient(TENANT_A, ACTOR_A)
    let aEntityId
    try {
      const r = await ca.callTool({
        name: 'entity.create',
        arguments: { entityKindName: 'person' },
      })
      aEntityId = JSON.parse(r.content.find((c) => c.type === 'text').text).effects[0].entityId
    } finally {
      await ca.close()
    }
    const cb = await mcpClient(TENANT_B, ACTOR_B)
    try {
      const r = await cb.callTool({ name: 'entity.get', arguments: { entityId: aEntityId } })
      const parsed = JSON.parse(r.content.find((c) => c.type === 'text').text)
      const entity = parsed?.entity ?? parsed
      const leaked = entity && entity.id === aEntityId
      record(
        'M4',
        'MCP cross-tenant read (B reads A entity)',
        'MCP',
        'null / not visible',
        leaked ? 'LEAKED' : 'not visible',
        !leaked,
      )
    } finally {
      await cb.close()
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required (disposable project).')
  await setup()
  const restProc = spawn(process.execPath, ['dist/index.js'], {
    cwd: 'apps/rest-api',
    env: { ...process.env, PORT: String(REST_PORT), REST_RATE_MAX: '20' },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const mcpProc = spawn(process.execPath, ['dist/index.js'], {
    cwd: 'apps/mcp-server',
    env: { ...process.env, MCP_TRANSPORT: 'http', PORT: String(MCP_PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  try {
    await waitHealth(`${REST}/health`)
    await waitHealth(`http://localhost:${MCP_PORT}/health`)
    await runRestAttacks()
    await runMcpAttacks()
  } finally {
    restProc.kill()
    mcpProc.kill()
    await teardown()
    await closeDbPool()
  }

  const fails = results.filter((r) => r.verdict === 'FAIL')
  console.log('\n=== ADVERSARIAL ADAPTER AUDIT RESULTS ===\n')
  for (const r of results) {
    console.log(
      `[${r.verdict}] ${r.id} (${r.surface}) ${r.attack}\n        expected: ${r.expected} | observed: ${r.observed}`,
    )
  }
  console.log(`\n${results.length} attacks, ${fails.length} FAIL.`)
  console.log('JSON_RESULTS_BEGIN')
  console.log(JSON.stringify(results, null, 2))
  console.log('JSON_RESULTS_END')
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('Harness error:', e)
  try {
    await closeDbPool()
  } catch {
    /* ignore */
  }
  process.exit(2)
})
