import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listContacts,
  getContact,
  inviteClientToPortal,
  revokeClientPortalAccess,
  resolveContactMatterEntityIds,
  listDocumentsForMatters,
  getHistoryForMatters,
  getContactEngagementOverride,
  setContactEngagementLetter,
  listEngagementLetters,
  type ContactSummary,
  type ContactDetail,
  type RevokePortalAccessResult,
  type PersonDocumentItem,
  type MatterHistory,
  type EngagementLetterSummary,
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

interface RevokeInput {
  contactEntityId: string
}

// A2.3 — the inverse of invite_to_portal: revoke a client's portal access.
// Attorney-only WRITE; see api/portalAccess.ts for the two-write mechanics
// (deactivate the mapped actor + archive the contact) and why both matter.
const revokeTool: Tool<RevokeInput, RevokePortalAccessResult> = {
  name: 'legal.contact.revoke_portal_access',
  description:
    'Remove a client contact’s portal access: deactivates their portal login and archives ' +
    'the contact so a future sign-in attempt cannot silently re-provision a new account. ' +
    'There is currently no restore path — re-inviting sends a new set-password email but ' +
    'the sign-in will still be refused while the contact is archived. Use only when the ' +
    'client relationship is actually ending.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    return revokeClientPortalAccess(ctx, input.contactEntityId)
  },
}

// Contact detail — Documents tab: every document across all this contact's
// matters (generated + uploaded), each tagged with its matter.
const documentsTool: Tool<{ contactEntityId: string }, { documents: PersonDocumentItem[] }> = {
  name: 'legal.contact.documents',
  description:
    "Every document across all of a contact's matters (generated drafts + uploaded files), newest first, tagged by matter.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const matterIds = await resolveContactMatterEntityIds(ctx, input.contactEntityId)
    const documents = await listDocumentsForMatters(ctx, matterIds)
    return { documents }
  },
}

// Contact detail — Activity tab: the audit/timeline aggregated across all this
// contact's matters.
const activityTool: Tool<{ contactEntityId: string }, { history: MatterHistory }> = {
  name: 'legal.contact.activity',
  description: "All activity (actions + events) across a contact's matters, for the Activity tab.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const matterIds = await resolveContactMatterEntityIds(ctx, input.contactEntityId)
    const history = await getHistoryForMatters(ctx, matterIds)
    return { history }
  },
}

// ── ENGAGEMENT-TEMPLATES-1 Phase 2 — per-contact engagement-letter override ──
// Which engagement letter this specific client signs, choosable from the firm's
// library; empty = the firm default. Read returns the current override + the
// library options so the CRM record can render one selector.
const engagementGetTool: Tool<
  { contactEntityId: string },
  { overrideTemplateId: string | null; letters: EngagementLetterSummary[] }
> = {
  name: 'legal.contact.engagement_letter.get',
  description:
    "The contact's engagement-letter override (the template id they sign instead of the firm default, or null) plus the firm's engagement-letter library to choose from. Empty override = the client signs the firm default.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    overrideTemplateId: await getContactEngagementOverride(ctx, input.contactEntityId),
    letters: await listEngagementLetters(ctx),
  }),
}

const engagementSetTool: Tool<
  { contactEntityId: string; templateId: string | null },
  { templateId: string | null }
> = {
  name: 'legal.contact.set_engagement_letter',
  description:
    'Choose which engagement letter this specific client signs (a template id from the firm library), or pass null to clear it back to the firm default. Attorney-only.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    await setContactEngagementLetter(ctx, input.contactEntityId, input.templateId ?? null),
}

registerTool(listTool)
registerTool(getTool)
registerTool(inviteTool)
registerTool(revokeTool)
registerTool(documentsTool)
registerTool(activityTool)
registerTool(engagementGetTool)
registerTool(engagementSetTool)
