import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEvent, lookupKindId } from './common.js'

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

// The mapped portal actor for a contact, straight from the portal_actor_id
// attribute (no status filter — revoke/restore need the mapping either way).
async function mappedPortalActorId(
  client: DbClient,
  tenantId: string,
  clientContactId: string,
): Promise<string | null> {
  const mapped = await client.query<{ value: string }>(
    `SELECT a.value #>> '{}' AS value
     FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = $2
       AND akd.kind_name = 'portal_actor_id'
       AND (a.valid_to IS NULL OR a.valid_to > now())
     ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, clientContactId],
  )
  return mapped.rows[0]?.value ?? null
}

// The inverse 0184 never had: reactivate a revoked portal actor. Needed because
// the login-only portal delete keeps the client_contact active, so a re-invite
// must be able to reopen the door. Deliberately NOT folded into
// provision_portal_actor: its idempotency returns the mapping as-is, and a
// provision that reactivated would let any sign-in path silently undo a revoke.
registerActionHandler(
  'legal.client.restore_portal_access',
  async (ctx, client: DbClient, payload, actionId) => {
    const p = payload as unknown as RevokePayload
    if (!p.client_contact_id) throw new Error('client_contact_id is required.')

    const actorId = await mappedPortalActorId(client, ctx.tenantId, p.client_contact_id)
    if (!actorId) {
      // Never provisioned — nothing to restore; the invite/sign-in flow will
      // provision a fresh actor as usual.
      return { clientContactId: p.client_contact_id, actorId: null, restored: false }
    }
    const r = await client.query(
      `UPDATE actor SET status = 'active'
        WHERE tenant_id = $1 AND id = $2 AND status = 'inactive'`,
      [ctx.tenantId, actorId],
    )
    const restored = (r.rowCount ?? 0) > 0
    if (restored) {
      await insertEvent(client, {
        tenantId: ctx.tenantId,
        actionId,
        eventKindName: 'portal.access_restored',
        primaryEntityId: p.client_contact_id,
        data: { client_contact_id: p.client_contact_id, actor_id: actorId },
        sourceType: 'human',
        sourceRef: ctx.actorId,
      })
    }
    return { clientContactId: p.client_contact_id, actorId, restored }
  },
)

// Users & Roles portal tab: set a contact's portal tier. 'standard' = everything
// except the AI assistant; 'self_serve' = full access. Absent means self_serve
// (the pre-existing behavior), so this attribute only ever narrows deliberately.
interface SetPortalUserTypePayload {
  client_contact_id: string
  portal_user_type: string
}

const PORTAL_USER_TYPES = ['standard', 'self_serve']

registerActionHandler(
  'legal.client.set_portal_user_type',
  async (ctx, client: DbClient, payload, actionId) => {
    const p = payload as unknown as SetPortalUserTypePayload
    if (!p.client_contact_id) throw new Error('client_contact_id is required.')
    const type = (p.portal_user_type ?? '').trim()
    if (!PORTAL_USER_TYPES.includes(type)) {
      throw new Error(`portal_user_type must be one of: ${PORTAL_USER_TYPES.join(', ')}`)
    }

    const contact = await client.query(
      `SELECT e.id FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.id = $1 AND e.tenant_id = $2
         AND ekd.kind_name = 'client_contact' AND e.status = 'active'`,
      [p.client_contact_id, ctx.tenantId],
    )
    if (contact.rowCount === 0) throw new Error('Unknown client contact.')

    const attrKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      'portal_user_type',
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: p.client_contact_id,
      attributeKindId: attrKindId,
      value: type,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
    return { clientContactId: p.client_contact_id, portalUserType: type }
  },
)
