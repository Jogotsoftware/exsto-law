// Entry point. Selects the MCP transport from MCP_TRANSPORT:
//   http  (default) — streamable HTTP, principal from x-tenant-id / x-actor-id headers
//   stdio           — one principal from EXSTO_TENANT_ID / EXSTO_ACTOR_ID env
//
// Both transports serve the same tool catalog over the same operation core; this
// file only chooses how the bytes arrive.
import { startTracing } from '@exsto/shared'
import { startHttpServer } from './http.js'
import { startStdioServer } from './stdio.js'

export { buildMcpServer, SERVER_INFO } from './server.js'
export { createHttpServer, startHttpServer } from './http.js'
export { startStdioServer } from './stdio.js'

async function main(): Promise<void> {
  await startTracing('exsto-mcp-server')
  const transport = (process.env.MCP_TRANSPORT ?? 'http').toLowerCase()
  if (transport === 'stdio') {
    await startStdioServer()
  } else {
    await startHttpServer()
  }
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('index.js') || entry.endsWith('index.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
