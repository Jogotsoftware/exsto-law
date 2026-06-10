// The REST surface is GENERATED from the same tool catalog the MCP adapter uses
// (@exsto/mcp-tools getTools()), so REST and MCP cannot drift — adding a tool adds
// a REST endpoint and an OpenAPI path automatically. Each tool maps to
// `POST /v1/<tool.name with '.' -> '/'>` with the tool input as the JSON body.
import { getTools, type Tool } from '@exsto/mcp-tools'

// System / admin operations excluded from the public REST surface (schema-as-data
// mutations and other privileged ops are admin-gated, not exposed to API keys).
export const SYSTEM_TOOLS = new Set<string>(['substrate.kind.define'])

export function exposedTools(): Tool[] {
  return getTools().filter((t) => !SYSTEM_TOOLS.has(t.name))
}

// `entity.create` <-> `entity/create`. Tool names use '.', never '/', so this is
// a clean bijection.
export function toolToPath(name: string): string {
  return name.replace(/\./g, '/')
}

export function pathToToolName(path: string): string {
  return path.replace(/\//g, '.')
}
