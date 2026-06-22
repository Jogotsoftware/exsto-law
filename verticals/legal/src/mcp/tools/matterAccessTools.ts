import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getMatterAccess,
  setMatterOwner,
  grantMatterAccess,
  type MatterAccess,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Read a matter's owner + send-access grants (who may send client mail / signature
// requests on it).
registerTool({
  name: 'legal.matter.access_get',
  description:
    'Get a matter’s owner actor id and the list of additional actor ids granted send access.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) =>
    getMatterAccess(ctx, (input as { matterEntityId: string }).matterEntityId),
} satisfies Tool<{ matterEntityId: string }, MatterAccess>)

// Set / transfer a matter's owning attorney (owner or admin only — enforced in the
// action handler).
registerTool({
  name: 'legal.matter.set_owner',
  description:
    'Set or transfer the owning attorney of a matter (the actor id). Only the current owner or a firm admin may do this.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      ownerActorId: { type: 'string', description: 'The attorney actor id to make owner.' },
    },
    required: ['matterEntityId', 'ownerActorId'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => {
    const i = input as { matterEntityId: string; ownerActorId: string }
    return setMatterOwner(ctx, { matterEntityId: i.matterEntityId, ownerActorId: i.ownerActorId })
  },
} satisfies Tool<{ matterEntityId: string; ownerActorId: string }, unknown>)

// Replace the set of attorney actor ids granted send access (owner or admin only).
registerTool({
  name: 'legal.matter.grant_access',
  description:
    'Replace the set of attorney actor ids granted send access to a matter (in addition to the owner). Only the owner or a firm admin may do this. Pass the full desired list; it replaces the prior grants.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      actorIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['matterEntityId', 'actorIds'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => {
    const i = input as { matterEntityId: string; actorIds: string[] }
    return grantMatterAccess(ctx, { matterEntityId: i.matterEntityId, actorIds: i.actorIds })
  },
} satisfies Tool<{ matterEntityId: string; actorIds: string[] }, unknown>)
