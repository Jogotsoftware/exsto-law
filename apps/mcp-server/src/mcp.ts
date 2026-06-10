import { findTool, getTools } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'

export interface McpRequest {
  toolName: string
  input: unknown
  tenantId: string
  actorId: string
}

export async function dispatchMcp(request: McpRequest): Promise<unknown> {
  const tool = findTool(request.toolName)
  if (!tool) {
    throw new Error(`Tool not found: ${request.toolName}`)
  }

  const ctx: ActionContext = {
    tenantId: request.tenantId,
    actorId: request.actorId,
  }

  return tool.handler(ctx, request.input)
}

export function listToolNames(): string[] {
  return getTools().map((tool) => tool.name)
}
