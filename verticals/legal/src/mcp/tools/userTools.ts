// User-management MCP tools (S9 — WP9.3). Thin adapter over the operation-core
// users API; the admin gate lives in that API (requireAdmin) so it holds for any
// caller. legal.user.me is intentionally ungated (anyone may ask "am I admin?").
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import {
  assignUserRole,
  deactivateUser,
  deleteUser,
  inviteUser,
  listUsers,
  setPortalUserType,
  whoAmI,
  type FirmRole,
  type FirmUser,
  type PortalUserType,
  type WhoAmI,
} from '../../index.js'
import { listPortalUsers, type PortalUserRow } from '../../queries/portalUsers.js'

registerTool({
  name: 'legal.user.me',
  description:
    'Who is the calling actor, and are they a firm admin? Used to gate the user-management UI.',
  mode: 'read',
  handler: async (ctx: ActionContext) => whoAmI(ctx),
} satisfies Tool<Record<string, never>, WhoAmI>)

registerTool({
  name: 'legal.user.list',
  description: "List the firm's human users with status and derived role. Admin only.",
  mode: 'read',
  handler: async (ctx: ActionContext) => listUsers(ctx),
} satisfies Tool<Record<string, never>, { users: FirmUser[]; roles: FirmRole[] }>)

registerTool({
  name: 'legal.user.invite',
  description: 'Create or re-activate a firm user (by email) and assign a role. Admin only.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await inviteUser(ctx, input)
    return { ok: true }
  },
} satisfies Tool<{ email: string; displayName?: string; roleName?: string }, { ok: true }>)

registerTool({
  name: 'legal.user.assign_role',
  description: 'Re-bind a firm user to a role (replaces their permission scopes). Admin only.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await assignUserRole(ctx, input)
    return { ok: true }
  },
} satisfies Tool<{ actorId: string; roleName: string }, { ok: true }>)

registerTool({
  name: 'legal.user.deactivate',
  description: 'Deactivate a firm user and revoke their access. Admin only.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await deactivateUser(ctx, input)
    return { ok: true }
  },
} satisfies Tool<{ actorId: string }, { ok: true }>)

registerTool({
  name: 'legal.user.delete',
  description:
    'Remove a firm user from the Users & Roles list (deactivate + hide; history preserved, re-invite restores). Admin only.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await deleteUser(ctx, input)
    return { ok: true }
  },
} satisfies Tool<{ actorId: string }, { ok: true }>)

registerTool({
  name: 'legal.user.portal_list',
  description:
    "List the firm's portal users (client contacts with a portal account): name, email, client company, portal tier, status. Admin only.",
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ users: await listPortalUsers(ctx) }),
} satisfies Tool<Record<string, never>, { users: PortalUserRow[] }>)

registerTool({
  name: 'legal.user.set_portal_user_type',
  description:
    "Set a portal user's tier: 'standard' (everything except the AI assistant) or 'self_serve' (full access). Admin only.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await setPortalUserType(ctx, input.contactEntityId, input.portalUserType)
    return { ok: true }
  },
} satisfies Tool<{ contactEntityId: string; portalUserType: PortalUserType }, { ok: true }>)
