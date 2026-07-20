import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertEvent } from './common.js'

// A2.3 — the inverse of legal.contact.invite_to_portal: revoke a client's
// portal access. Root cause of the "I deactivated them but they can still log
// in" confusion: no client-account removal path existed anywhere, and
// isClientContactActive / findClientContactMembershipsByEmail (clientIdentity.ts)
// both gate on entity.status = 'active' on the client_contact — nothing was
// ever flipping it.
//
// Two durable writes, both required (either alone leaves a re-provision path
// open — see clientSessionMint.ts's provisionClientPortalActor fallback):
//   1. legal.client.revoke_portal_access (this file) flips the client's
//      mapped portal actor's status to 'inactive' — same raw UPDATE shape as
//      legal.user.deactivate (handlers/users.ts) but WITHOUT its admin-rank
//      authorization: a client actor has no staff rank to compare, and any
//      attorney at the firm may revoke their own firm's client's access.
//   2. entity.archive (the existing core action, reused as-is) on the
//      client_contact itself. isClientContactActive is what actually stops
//      clientSessionMint from lazily re-provisioning a fresh actor on the
//      contact's next sign-in attempt — deactivating the actor alone would
//      leave that fallback free to mint a new one.

interface RevokePayload {
  client_contact_id: string
}

registerActionHandler(
  'legal.client.revoke_portal_access',
  async (ctx, client: DbClient, payload, actionId) => {
    const p = payload as unknown as RevokePayload
    if (!p.client_contact_id) throw new Error('client_contact_id is required.')

    const mapped = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2
         AND akd.kind_name = 'portal_actor_id'
         AND (a.valid_to IS NULL OR a.valid_to > now())
       ORDER BY a.valid_from DESC LIMIT 1`,
      [ctx.tenantId, p.client_contact_id],
    )
    const actorId = mapped.rows[0]?.value ?? null
    // No portal_actor_id yet (never signed in / provisioned) — nothing to
    // deactivate; entity.archive below still stops any future provisioning.
    if (actorId) {
      await client.query(`UPDATE actor SET status = 'inactive' WHERE tenant_id = $1 AND id = $2`, [
        ctx.tenantId,
        actorId,
      ])
    }

    await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'portal.access_revoked',
      primaryEntityId: p.client_contact_id,
      data: {
        client_contact_id: p.client_contact_id,
        actor_id: actorId,
        actor_deactivated: Boolean(actorId),
      },
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })

    return { clientContactId: p.client_contact_id, actorId, actorDeactivated: Boolean(actorId) }
  },
)
