import { registerTool, type Tool } from '@exsto/mcp-tools'
import { listContacts, getContact, type ContactSummary, type ContactDetail } from '../../index.js'
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

registerTool(listTool)
registerTool(getTool)
