import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getMatterHistory, type MatterHistory } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// WP5: every step of a matter visible as audited actions (with intent,
// autonomy tier, actor, trace linkage) plus the lifecycle event timeline.
const tool: Tool<{ matterEntityId: string }, MatterHistory> = {
  name: 'legal.matter.history',
  description:
    'Audit surface for a matter: every action row (kind, intent, autonomy tier, actor, reasoning-trace linkage) and lifecycle event, oldest first.',
  mode: 'read',
  handler: (ctx: ActionContext, input) => getMatterHistory(ctx, input.matterEntityId),
}

registerTool(tool)
