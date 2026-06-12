import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getClientMatterTimeline,
  listClientMatters,
  type ClientMatterTimeline,
  type ClientMatterListItem,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// AUTHENTICATED client-portal tools. These are reachable ONLY through the authed
// route (/api/client/portal/mcp) — they are in CLIENT_PORTAL_AUTHED_TOOLS, NOT
// the public CLIENT_PORTAL_TOOLS allowlist. Both are read-mode.
//
// Trust boundary: clientContactId and matterEntityId arrive on `input`, but the
// ROUTE stamps them from the verified session cookie — the route also asserts
// matterEntityId ∈ session.matterIds BEFORE dispatch. These handlers therefore
// trust ctx (tenant) + the stamped fields; they never read identity from a body
// the client controls. (ctx.actorId is the public-intake system actor; client
// identity lives on client_contact — ADR 0035.)

interface TimelineInput {
  matterEntityId: string
}

const matterTimelineTool: Tool<TimelineInput, { timeline: ClientMatterTimeline | null }> = {
  name: 'legal.client.matter_timeline',
  description:
    "Client-safe status + milestone timeline for one of the signed-in client's own matters.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    timeline: await getClientMatterTimeline(ctx, input.matterEntityId),
  }),
}

interface MattersInput {
  // Stamped by the authed route from the session cookie's clientContactId.
  clientContactId: string
}

const mattersTool: Tool<MattersInput, { matters: ClientMatterListItem[] }> = {
  name: 'legal.client.matters',
  description: 'List the matters the signed-in client is associated with (the matter switcher).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    matters: await listClientMatters(ctx, input.clientContactId),
  }),
}

registerTool(matterTimelineTool)
registerTool(mattersTool)
