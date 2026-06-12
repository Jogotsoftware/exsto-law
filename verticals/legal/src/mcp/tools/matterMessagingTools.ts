import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getMatterThread, postAttorneyMessage, type PortalMessage } from '../../index.js'
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

registerTool(matterThreadGetTool)
registerTool(matterMessagePostTool)
