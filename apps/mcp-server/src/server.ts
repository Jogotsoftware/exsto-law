// Spec-compliant MCP server built on the official SDK, bound to one principal.
//
// TRANSPORT ONLY: the tool catalog and the operation core are untouched. This maps
// the MCP `tools/list` and `tools/call` methods onto the existing
// `@exsto/mcp-tools` registry (`getTools` / `dispatchMcp`). The principal
// (tenant + actor) is supplied by the transport layer — env for stdio, validated
// headers for HTTP — and is NEVER read from tool arguments, so a client cannot
// choose its own tenant (invariant 1 / ADR 0037).
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ActionContext } from '@exsto/substrate'
import { getTools } from '@exsto/mcp-tools'
import { dispatchMcp } from './mcp.js'

export const SERVER_INFO = { name: 'exsto-substrate-mcp-server', version: '0.1.0' } as const

// Each tool carries its own JSON Schema (packages/mcp-tools); we advertise it
// verbatim so the MCP `tools/list` contract matches the handler and the OpenAPI.
// A tool without a schema falls back to a permissive object.
const PERMISSIVE_INPUT_SCHEMA = { type: 'object' as const, additionalProperties: true }

export function buildMcpServer(ctx: ActionContext): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? PERMISSIVE_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: tool.mode === 'read',
        destructiveHint: false,
      },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      const result = await dispatchMcp({
        toolName: name,
        input: args ?? {},
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
      })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      return {
        content: [
          { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
        ],
        isError: true,
      }
    }
  })

  return server
}
