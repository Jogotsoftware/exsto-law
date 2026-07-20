import { submitAction, type ActionContext } from '@exsto/substrate'

// A2.3 — the inverse of legal.contact.invite_to_portal: revoke a client's
// portal access. The action handler (legal.client.revoke_portal_access) is
// registered in handlers/clientPortalAccess.ts. This file exports the wrapper
// functions for invoking the action and composing it with entity.archive.

export interface RevokePortalAccessResult {
  clientContactId: string
  actorDeactivated: boolean
  contactArchived: boolean
}

export async function revokeClientPortalAccess(
  ctx: ActionContext,
  clientContactId: string,
): Promise<RevokePortalAccessResult> {
  if (!clientContactId?.trim()) throw new Error('clientContactId is required.')

  const revoke = await submitAction(ctx, {
    actionKindName: 'legal.client.revoke_portal_access',
    intentKind: 'enforcement',
    payload: { client_contact_id: clientContactId },
  })
  await submitAction(ctx, {
    actionKindName: 'entity.archive',
    intentKind: 'enforcement',
    payload: { entity_id: clientContactId },
  })

  const effect = revoke.effects[0] as { actorDeactivated: boolean }
  return {
    clientContactId,
    actorDeactivated: effect.actorDeactivated,
    contactArchived: true,
  }
}
