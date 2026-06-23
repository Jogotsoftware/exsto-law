import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listContacts,
  getContact,
  inviteClientToPortal,
  type ContactSummary,
  type ContactDetail,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const listTool: Tool<Record<string, never>, { contacts: ContactSummary[] }> = {
  name: 'legal.contact.list',
  description:
    'List all client contacts for the current tenant, with matter counts and last activity.',
  mode: 'read',
  handler: async (ctx: ActionContext) => {
    const contacts = await listContacts(ctx)
    return { contacts }
  },
}

interface GetInput {
  contactEntityId: string
}

const getTool: Tool<GetInput, { contact: ContactDetail | null }> = {
  name: 'legal.contact.get',
  description: 'Fetch a contact with their attributes and full list of matters.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const contact = await getContact(ctx, input.contactEntityId)
    return { contact }
  },
}

interface InviteInput {
  contactEntityId: string
}

// Attorney-initiated portal invite: emails the contact a set-password link so they
// can create portal access. A WRITE (it queues an outbound email + later records
// notification.send), so it is attorney-only — never in the client allowlist.
const inviteTool: Tool<InviteInput, { ok: boolean; email?: string; error?: string }> = {
  name: 'legal.contact.invite_to_portal',
  description:
    'Email a client contact a secure link to set their portal password and access their matters. ' +
    'Re-sending generates a fresh link (and resets their password).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    return inviteClientToPortal(ctx, input.contactEntityId)
  },
}

registerTool(listTool)
registerTool(getTool)
registerTool(inviteTool)
