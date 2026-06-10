import type { ActionContext } from '@exsto/substrate'

export type ToolMode = 'read' | 'write'

export interface ToolHandler<Input = unknown, Output = unknown> {
  (ctx: ActionContext, input: Input): Promise<Output>
}

// A JSON Schema (draft 2020-12) describing a tool's input. Kept as a structural
// type so it can be authored as a plain object literal next to the tool and
// rendered verbatim by BOTH adapters (MCP tools/list inputSchema and the OpenAPI
// requestBody) — one source of truth, no drift.
export type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: unknown[]
  description?: string
  additionalProperties?: boolean | JsonSchema
  [key: string]: unknown
}

export interface Tool<Input = unknown, Output = unknown> {
  name: string
  description: string
  mode: ToolMode
  handler: ToolHandler<Input, Output>
  // The input contract as JSON Schema. Optional for backward compatibility; tools
  // without one advertise a permissive object. Authored alongside the handler.
  inputSchema?: JsonSchema
}

const tools: Array<Tool<unknown, unknown>> = []

export function registerTool<Input = unknown, Output = unknown>(tool: Tool<Input, Output>): void {
  tools.push(tool as Tool<unknown, unknown>)
}

export function getTools(): Array<Tool<unknown, unknown>> {
  return [...tools]
}

export function findTool(name: string): Tool<unknown, unknown> | undefined {
  return tools.find((tool) => tool.name === name)
}

export function clearTools(): void {
  tools.length = 0
}
