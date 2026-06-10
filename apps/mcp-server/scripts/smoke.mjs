// End-to-end smoke test: drive the built MCP server with a REAL MCP client (the
// official SDK Client) over BOTH transports — streamable HTTP and stdio — and
// exercise tools/list + tools/call against live exsto-dev.
//
// Run after `pnpm build`, from apps/mcp-server, with DATABASE_URL set:
//   DATABASE_URL=... node ./scripts/smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ACTOR = '00000000-0000-0000-0001-000000000001'
const PORT = 4123
const KNOWN_TOOLS = ['substrate.capability.list', 'entity.create', 'entity.get', 'entity.search']

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
}

function summarize(result) {
  const text = result?.content?.find((c) => c.type === 'text')?.text ?? ''
  return text.slice(0, 80).replace(/\s+/g, ' ')
}

async function waitForHealth(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(150)
  }
  throw new Error('server did not become healthy: ' + url)
}

async function testHttp() {
  const proc = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, MCP_TRANSPORT: 'http', PORT: String(PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  try {
    await waitForHealth(`http://localhost:${PORT}/health`)
    const client = new Client({ name: 'exsto-smoke', version: '0.0.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`), {
      requestInit: { headers: { 'x-tenant-id': TENANT, 'x-actor-id': ACTOR } },
    })
    await client.connect(transport)
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    for (const k of KNOWN_TOOLS) assert(names.includes(k), `HTTP tools/list missing ${k}`)
    const cap = await client.callTool({ name: 'substrate.capability.list', arguments: {} })
    assert(!cap.isError, 'HTTP capability.list returned isError')
    assert(summarize(cap).length > 0, 'HTTP capability.list empty')
    // Cross-tenant guard: an unauthenticated call (no headers) must be rejected.
    const bad = await fetch(`http://localhost:${PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    assert(bad.status === 401, `HTTP missing-principal should be 401, got ${bad.status}`)
    await client.close()
    console.log(
      `  HTTP: ${tools.length} tools listed; capability.list ok ("${summarize(cap)}…"); no-principal -> 401`,
    )
  } finally {
    proc.kill()
  }
}

async function testStdio() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env: { ...process.env, MCP_TRANSPORT: 'stdio', EXSTO_TENANT_ID: TENANT, EXSTO_ACTOR_ID: ACTOR },
  })
  const client = new Client({ name: 'exsto-smoke', version: '0.0.0' }, { capabilities: {} })
  await client.connect(transport)
  try {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    for (const k of KNOWN_TOOLS) assert(names.includes(k), `stdio tools/list missing ${k}`)
    const cap = await client.callTool({ name: 'substrate.capability.list', arguments: {} })
    assert(!cap.isError, 'stdio capability.list returned isError')
    console.log(`  stdio: ${tools.length} tools listed; capability.list ok ("${summarize(cap)}…")`)
  } finally {
    await client.close()
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the smoke test.')
  console.log('MCP transport smoke test (real SDK client, live exsto-dev):')
  await testHttp()
  await testStdio()
  console.log('SMOKE_OK: both transports list tools and call substrate.capability.list end to end.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
