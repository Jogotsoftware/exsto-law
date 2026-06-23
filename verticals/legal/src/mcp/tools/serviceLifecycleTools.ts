// Service lifecycle MCP tools (ADR 0045, PR4a) — the attorney-admin surface over a
// service's workflow stage graph (workflow_definition.states). The WRITE tool goes
// through the action layer (legal.service.set_lifecycle). NEITHER belongs in
// CLIENT_PORTAL_TOOLS: authoring a service's workflow is attorney-only, exactly like
// the other service-library tools (clientPolicy.ts is default-deny, so leaving them
// out is sufficient — do not add them there).
import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getServiceLifecycle, setServiceLifecycle } from '../../index.js'
import type { Lifecycle } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const lifecycleGetTool: Tool<
  { serviceKey: string },
  { lifecycle: { graph: Lifecycle; version: number } | null }
> = {
  name: 'legal.service.lifecycle.get',
  description:
    "Get a service offering's workflow lifecycle: the ordered stage graph stored in its active workflow_definition.states (ADR 0045). Returns { graph, version } or null when the service has no lifecycle authored yet.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    lifecycle: await getServiceLifecycle(ctx, input.serviceKey),
  }),
}

const lifecycleSetTool: Tool<
  { serviceKey: string; graph: Lifecycle },
  { workflowDefinitionId: string; serviceKey: string; version: number }
> = {
  name: 'legal.service.lifecycle.set',
  description:
    "Author a service offering's workflow lifecycle. Validates the stage graph (exactly one entry stage, a reachable terminal, valid edges/gates) and writes a NEW immutable version: the prior definition is sealed and version+1 is inserted with the new states, carrying the service's metadata, transitions, and participating entity kinds forward unchanged. New matters then run these steps.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    setServiceLifecycle(ctx, input.serviceKey, input.graph),
}

registerTool(lifecycleGetTool)
registerTool(lifecycleSetTool)
