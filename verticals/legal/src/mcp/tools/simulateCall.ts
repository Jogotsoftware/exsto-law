import { registerTool, type Tool } from '@exsto/mcp-tools'
import { simulateCall, type SimulateCallInput } from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

const tool: Tool<SimulateCallInput, ActionResult> = {
  name: 'legal.call.simulate',
  description:
    'Generate a synthetic Granola-shaped call session + transcript for a matter (v1 stub).',
  mode: 'write',
  handler: (ctx: ActionContext, input) => simulateCall(ctx, input),
}

registerTool(tool)
