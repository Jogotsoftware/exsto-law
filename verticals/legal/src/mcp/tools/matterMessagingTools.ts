import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getMatterThread,
  postAttorneyMessage,
  listPortalThreads,
  type PortalMessage,
  type PortalThreadSummary,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Attorney side of the client↔attorney portal messaging (Client Portal PR2).
// Reachable ONLY through the authed attorney route (/api/attorney/mcp), which
// verifies the attorney's session cookie; ctx.actorId is the attorney actor, so
// a posted message carries attorney provenance (sender_actor_id). The same
// getMatterThread read backs both the attorney view and the client portal —
// it returns only author + body + sentAt (no actor names, no internal payload).

interface ThreadGetInput {
  matterEntityId: string
}

const matterThreadGetTool: Tool<ThreadGetInput, { messages: PortalMessage[] }> = {
  name: 'legal.matter.thread_get',
  description: 'Read the client↔attorney portal message thread for a matter.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    messages: await getMatterThread(ctx, input.matterEntityId),
  }),
}

interface MessagePostInput {
  matterEntityId: string
  body: string
}

const matterMessagePostTool: Tool<MessagePostInput, { posted: boolean }> = {
  name: 'legal.matter.message_post',
  description: 'Post a reply to the client on a matter portal thread (attorney provenance).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await postAttorneyMessage(ctx, {
      matterEntityId: input.matterEntityId,
      body: input.body,
    })
    return { posted: true }
  },
}

// WP-I (Mail) — the Portal chat tab's left-pane list: every matter with a
// portal thread, tenant-wide, newest-first, with the unread heuristic. Backs
// legal.matter.thread_get for the detail pane (same tool the matter Activity
// tab already uses) and legal.matter.message_post for inline reply — no new
// write path, this is a read aggregation only.
const matterPortalThreadsTool: Tool<Record<string, never>, { threads: PortalThreadSummary[] }> = {
  name: 'legal.matter.portal_threads',
  description:
    "Every matter with a client↔attorney portal thread, tenant-wide, newest-first — the Mail tab's Portal chat list. Each row carries the matter, client name, last message, and an unread count (client messages sent after the attorney's last reply).",
  mode: 'read',
  handler: async (ctx: ActionContext) => ({
    threads: await listPortalThreads(ctx),
  }),
}

registerTool(matterThreadGetTool)
registerTool(matterMessagePostTool)
registerTool(matterPortalThreadsTool)
