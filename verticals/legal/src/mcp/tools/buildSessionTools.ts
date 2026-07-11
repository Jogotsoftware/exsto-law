// UI-BUILDER-FIX-1 Phase 5 — attorney tool to CLOSE a service-build session.
// Sessions START server-side (the chat's recording half opens one on a build's
// first turn); the client calls this when the build finishes (service enabled),
// when the attorney switches services mid-build, or when build mode turns off.
// Attorney-only: NOT in any client policy allowlist.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import { closeBuildSession } from '../../api/buildSession.js'

const closeBuildSessionTool: Tool<
  { buildSessionId: string; reason?: 'completed' | 'switched' | 'abandoned' },
  { closed: true }
> = {
  name: 'legal.build_session.close',
  description:
    'Close a service-build session (the build finished, the attorney switched services, or build mode ended). The next build always starts a fresh session.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await closeBuildSession(ctx, input.buildSessionId, input.reason ?? 'completed')
    return { closed: true }
  },
}

registerTool(closeBuildSessionTool)
