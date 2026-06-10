// stdio transport for the MCP server (for local clients such as Claude Desktop /
// IDE integrations that launch the server as a subprocess).
//
// A stdio process serves a single principal: the launching host sets
// EXSTO_TENANT_ID + EXSTO_ACTOR_ID (and DATABASE_URL) in the process env. The DB
// connection must use the non-owner `authenticated` role (ADR 0037).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildMcpServer } from './server.js'

export async function startStdioServer(): Promise<void> {
  const tenantId = process.env.EXSTO_TENANT_ID
  const actorId = process.env.EXSTO_ACTOR_ID
  if (!tenantId || !actorId) {
    console.error(
      'ERROR: stdio transport requires EXSTO_TENANT_ID and EXSTO_ACTOR_ID in the environment.',
    )
    process.exit(1)
  }
  const server = buildMcpServer({ tenantId, actorId })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdout is the JSON-RPC channel; logs must go to stderr.
  console.error('exsto MCP server (stdio) ready.')
}
