import { submitAction, type ActionContext } from '@exsto/substrate'
import { withSuperuser } from '@exsto/shared'

// PORTAL-1 — the client-actor half of the portal account (WP1).
//
// provisionClientPortalActor runs the legal.client.provision_portal_actor action
// (idempotent): creates the client's own actor, writes the portal_actor_id
// mapping attribute on the client_contact, emits portal.account_created, and
// advances any matter parked on a send_portal_invite client gate. The SUBMITTING
// actor is whoever triggered provisioning (public-intake for the intake gate /
// set-password routes); the RESULTING actor is what every subsequent authed
// portal write runs as.

export interface ProvisionedPortalActor {
  actorId: string
  clientContactId: string
  created: boolean
}

export async function provisionClientPortalActor(
  ctx: ActionContext,
  input: {
    clientContactId: string
    matterEntityIds?: string[]
    trigger?: 'intake_gate' | 'invite' | 'login_backfill'
  },
): Promise<ProvisionedPortalActor> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.client.provision_portal_actor',
    intentKind: 'enforcement',
    payload: {
      client_contact_id: input.clientContactId,
      matter_entity_ids: input.matterEntityIds ?? [],
      trigger: input.trigger ?? 'invite',
    },
  })
  return res.effects[0] as ProvisionedPortalActor
}

// N1 — record that the client proved control of their portal email (followed
// the confirmation link / completed OTP verification). Idempotent at the
// handler level: a re-confirm (double resend, reloaded confirm page) returns
// the existing portal.email_confirmed event rather than duplicating it.
export interface PortalEmailConfirmation {
  eventId: string
  clientContactId: string
}

export async function confirmPortalEmail(
  ctx: ActionContext,
  input: { clientContactId: string },
): Promise<PortalEmailConfirmation> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.client.confirm_portal_email',
    intentKind: 'enforcement',
    payload: { client_contact_id: input.clientContactId },
  })
  return res.effects[0] as PortalEmailConfirmation
}

// Session-mint read: the client's portal actor id, or null if the account was
// never provisioned. Runs under withSuperuser for the same reason the sibling
// clientIdentity reads do — it is called from the auth bridge before a request
// context exists; everything is tenant- and contact-pinned.
export async function resolvePortalActorId(
  tenantId: string,
  clientContactId: string,
): Promise<string | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2
         AND akd.kind_name = 'portal_actor_id'
         AND (a.valid_to IS NULL OR a.valid_to > now())
       ORDER BY a.valid_from DESC LIMIT 1`,
      [tenantId, clientContactId],
    )
    const actorId = res.rows[0]?.value ?? null
    if (!actorId) return null
    // The mapped actor must still be active — a deactivated portal actor means
    // no portal session, same posture as isClientContactActive.
    const actor = await client.query<{ id: string }>(
      `SELECT id FROM actor WHERE id = $1 AND tenant_id = $2 AND status = 'active' LIMIT 1`,
      [actorId, tenantId],
    )
    return actor.rows[0]?.id ?? null
  })
}

// Login-only portal delete check: the contact HAS a portal_actor_id mapping but
// the mapped actor is inactive — access was revoked without archiving the
// contact (Users & Roles portal-tab delete). mintClientSession refuses on this,
// because provision_portal_actor's idempotency would otherwise hand the
// inactive actor straight back into a fresh session. Distinct from
// resolvePortalActorId, whose null means "provision one" to callers.
export async function isPortalAccessRevoked(
  tenantId: string,
  clientContactId: string,
): Promise<boolean> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ status: string }>(
      `SELECT act.status
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       JOIN actor act ON act.id = (a.value #>> '{}')::uuid AND act.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2
         AND akd.kind_name = 'portal_actor_id'
         AND (a.valid_to IS NULL OR a.valid_to > now())
       ORDER BY a.valid_from DESC LIMIT 1`,
      [tenantId, clientContactId],
    )
    return res.rows[0]?.status === 'inactive'
  })
}
