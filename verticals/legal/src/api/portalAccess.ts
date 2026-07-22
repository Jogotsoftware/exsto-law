import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import { requireAdmin } from './users.js'

// A2.3 — the inverse of legal.contact.invite_to_portal: revoke a client's
// portal access. The action handlers (legal.client.revoke_portal_access,
// legal.client.restore_portal_access, legal.client.set_portal_user_type) are
// registered in handlers/clientPortalAccess.ts. This file exports the wrapper
// functions for invoking the actions and composing revoke with entity.archive.

export type PortalUserType = 'standard' | 'self_serve'

// Absent attribute = full access: the pre-existing behavior for every live
// portal account, so deploying the tier gate never strips anyone silently.
export const DEFAULT_PORTAL_USER_TYPE: PortalUserType = 'self_serve'

export interface RevokePortalAccessResult {
  clientContactId: string
  actorDeactivated: boolean
  contactArchived: boolean
}

// Two flavors (Joe, 2026-07-21):
//   • archiveContact: true — the CRM contact page's "remove portal access":
//     the contact is archived out of the CRM too (the original 0184 behavior;
//     the archived contact is what stops clientSessionMint from re-provisioning).
//   • archiveContact: false — the Users & Roles portal tab's "delete": login
//     only, the person STAYS in the CRM. mintClientSession refuses the mapped
//     inactive actor directly (see isPortalAccessRevoked / portalAccount.ts),
//     and a re-invite restores access via legal.client.restore_portal_access.
export async function revokeClientPortalAccess(
  ctx: ActionContext,
  clientContactId: string,
  opts: { archiveContact: boolean } = { archiveContact: true },
): Promise<RevokePortalAccessResult> {
  if (!clientContactId?.trim()) throw new Error('clientContactId is required.')

  const revoke = await submitAction(ctx, {
    actionKindName: 'legal.client.revoke_portal_access',
    intentKind: 'enforcement',
    payload: { client_contact_id: clientContactId },
  })
  if (opts.archiveContact) {
    await submitAction(ctx, {
      actionKindName: 'entity.archive',
      intentKind: 'enforcement',
      payload: { entity_id: clientContactId },
    })
  }

  const effect = revoke.effects[0] as { actorDeactivated: boolean }
  return {
    clientContactId,
    actorDeactivated: effect.actorDeactivated,
    contactArchived: opts.archiveContact,
  }
}

// Reactivate a revoked portal actor (the re-invite's way back in after a
// login-only delete). No-ops when never provisioned or already active.
export async function restoreClientPortalAccess(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ActionResult> {
  if (!clientContactId?.trim()) throw new Error('clientContactId is required.')
  return submitAction(ctx, {
    actionKindName: 'legal.client.restore_portal_access',
    intentKind: 'adjustment',
    payload: { client_contact_id: clientContactId },
  })
}

export async function setPortalUserType(
  ctx: ActionContext,
  clientContactId: string,
  portalUserType: PortalUserType,
): Promise<ActionResult> {
  if (!clientContactId?.trim()) throw new Error('clientContactId is required.')
  // A Users & Roles management write, so the same gate as the firm-user ops
  // (revoke, by contrast, is deliberately any-attorney — 0184).
  await requireAdmin(ctx)
  return submitAction(ctx, {
    actionKindName: 'legal.client.set_portal_user_type',
    intentKind: 'adjustment',
    payload: { client_contact_id: clientContactId, portal_user_type: portalUserType },
  })
}
