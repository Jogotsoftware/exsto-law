import type { ActionContext } from '@exsto/substrate'
import { getContact } from '../queries/contacts.js'
import { queueNotification } from './notifications.js'
import { signPortalInviteToken } from './portalInviteToken.js'

// "Invite a client to the portal" — the attorney-initiated half of the
// invite + set-password account flow. Given a client_contact, mint a signed
// set-password invite token and email the contact (through the firm's Gmail, the
// same reliable channel as every other client email) a link to /portal/set-password.
//
// The link is delivered ONLY to the contact's on-file email, so possession proves
// email control; the set-password route then binds that proven identity to a
// Supabase Auth password and signs them straight in. Re-inviting is safe and
// idempotent: it mints a fresh token and (on the route side) resets the password,
// so this doubles as a password-reset path.

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exsto-law.netlify.app'
).replace(/\/$/, '')

export interface PortalInviteResult {
  ok: boolean
  /** The address the invite was sent to (only when ok). */
  email?: string
  /** Why it could not be sent (only when !ok). */
  error?: string
}

export async function inviteClientToPortal(
  ctx: ActionContext,
  contactEntityId: string,
): Promise<PortalInviteResult> {
  const contact = await getContact(ctx, contactEntityId)
  if (!contact) {
    return { ok: false, error: 'Contact not found.' }
  }
  const email = contact.email.trim()
  if (!email) {
    return {
      ok: false,
      error: 'This contact has no email on file. Add an email before inviting them to the portal.',
    }
  }

  // Token carries only the contact + tenant + expiry; the tenant is taken from the
  // attorney's authorized context (ctx), never from any client input.
  const token = signPortalInviteToken({
    clientContactId: contactEntityId,
    tenantId: ctx.tenantId,
  })
  const portalUrl = `${BASE_URL}/portal/set-password?token=${encodeURIComponent(token)}`

  await queueNotification(ctx, {
    routeKindName: 'client_portal_invite',
    to: email,
    variables: {
      client_full_name: contact.fullName || email,
      portal_url: portalUrl,
    },
  })

  return { ok: true, email }
}
