import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { queueNotification } from './notifications.js'
import { assertCanSendOnMatter } from './matterAccess.js'
import { assertEngagementAccepted } from './engagement.js'

// ───────────────────────────────────────────────────────────────────────────
// Client Portal PR2 — two-way client↔attorney messaging API.
//
// Writes go through submitAction (client.message.post / attorney.message.post);
// the handlers (handlers/clientMessage.ts) own the thread+message+event writes.
// This module wires the API surface the tools + UI call, plus the notification
// each post triggers (the email links to the portal/matter — NEVER the body).
//
// getMatterThread is the ONE client-safe read of the portal thread, reused by
// both the portal and the attorney matter view: it returns only author + body +
// sentAt (no actor names, no internal payload), tenant-scoped via RLS.
// ───────────────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? '').replace(/\/$/, '')

export interface PortalMessage {
  author: 'client' | 'attorney'
  body: string
  sentAt: string
}

// The matter number + the client's on-file email — needed to address the
// notifications. Resolved in one tenant-scoped read (the client_of contact's
// latest email attribute). Either field may be null.
async function matterNotifyTargets(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<{ matterNumber: string | null; clientEmail: string | null }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      matter_number: string | null
      client_email: string | null
    }>(
      `SELECT
         m.name AS matter_number,
         (SELECT lower(a.value #>> '{}')
            FROM relationship r
            JOIN relationship_kind_definition rkd
              ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
            JOIN attribute a ON a.entity_id = r.source_entity_id
            JOIN attribute_kind_definition akd
              ON akd.id = a.attribute_kind_id AND akd.kind_name = 'email'
            WHERE r.tenant_id = $1 AND r.target_entity_id = m.id
              AND (r.valid_to IS NULL OR r.valid_to > now())
            ORDER BY a.valid_from DESC
            LIMIT 1) AS client_email
       FROM entity m
       JOIN entity_kind_definition ekd ON ekd.id = m.entity_kind_id
       WHERE m.tenant_id = $1 AND m.id = $2 AND ekd.kind_name = 'matter'
       LIMIT 1`,
      [ctx.tenantId, matterEntityId],
    )
    const row = res.rows[0]
    return {
      matterNumber: row?.matter_number ?? null,
      clientEmail: row?.client_email ?? null,
    }
  })
}

export interface PostClientMessageInput {
  matterEntityId: string
  body: string
  // Stamped by the authed client route from the session cookie's clientContactId
  // (never trusted from a client-controlled body).
  clientContactId: string
}

// Client → attorney. Posts the message (client provenance) then queues the
// attorney notification (links to the matter page; no body in the email).
export async function postClientMessage(
  ctx: ActionContext,
  input: PostClientMessageInput,
): Promise<ActionResult> {
  const body = (input.body ?? '').trim()
  if (!body) throw new Error('Message body is required.')

  // WP-6 (review-queue law): a client-initiated message proceeds only past an
  // accepted firm engagement. Enforced HERE at the operation core — the portal's
  // locked Messages card is presentation, not the gate.
  await assertEngagementAccepted(ctx, input.clientContactId)

  const result = await submitAction(ctx, {
    actionKindName: 'client.message.post',
    intentKind: 'unknown',
    payload: {
      matter_entity_id: input.matterEntityId,
      client_contact_id: input.clientContactId,
      body,
    },
  })

  const { matterNumber } = await matterNotifyTargets(ctx, input.matterEntityId)
  await queueNotification(ctx, {
    routeKindName: 'attorney_portal_message',
    variables: {
      matter_entity_id: input.matterEntityId,
      matter_number: matterNumber,
      matter_url: BASE_URL ? `${BASE_URL}/attorney/matters/${input.matterEntityId}` : null,
    },
  })

  return result
}

export interface PostAttorneyMessageInput {
  matterEntityId: string
  body: string
}

// Attorney → client. Posts the reply (attorney provenance via ctx.actorId) then
// queues the client notification to the on-file email (links to the portal; no
// body in the email).
export async function postAttorneyMessage(
  ctx: ActionContext,
  input: PostAttorneyMessageInput,
): Promise<ActionResult> {
  const body = (input.body ?? '').trim()
  if (!body) throw new Error('Message body is required.')

  // Send authz (0088): posting an attorney reply emails the client (a client-facing
  // send), so only the matter owner / a granted attorney / a firm admin may do it.
  await assertCanSendOnMatter(ctx, input.matterEntityId)

  const result = await submitAction(ctx, {
    actionKindName: 'attorney.message.post',
    intentKind: 'unknown',
    payload: {
      matter_entity_id: input.matterEntityId,
      body,
    },
  })

  const { matterNumber, clientEmail } = await matterNotifyTargets(ctx, input.matterEntityId)
  await queueNotification(ctx, {
    routeKindName: 'client_portal_message',
    // Address the client's on-file email (the route's role resolution is a
    // backstop; clients have no actor to resolve from).
    to: clientEmail ?? undefined,
    variables: {
      matter_entity_id: input.matterEntityId,
      matter_number: matterNumber,
      portal_url: BASE_URL ? `${BASE_URL}/portal` : null,
    },
  })

  return result
}

// Client-safe read of the matter's portal thread: author + body + sentAt only,
// oldest-first. Tenant-scoped via RLS. Returns [] when the matter has no portal
// thread yet (the same empty result a stranger's matter id would yield — no
// oracle; per-matter authorization is enforced UPSTREAM in the authed route).
export async function getMatterThread(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<PortalMessage[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      author: string | null
      body: string | null
      sent_at: string
    }>(
      `SELECT
         m.payload->>'author' AS author,
         b.body AS body,
         to_char(m.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS sent_at
       FROM communication_thread t
       JOIN communication_message m ON m.tenant_id = t.tenant_id AND m.thread_id = t.id
       LEFT JOIN content_blob b ON b.id = m.body_blob_id
       WHERE t.tenant_id = $1
         AND t.participants->>'channel' = 'portal'
         AND $2::uuid = ANY(t.related_entity_ids)
       ORDER BY m.occurred_at ASC, m.recorded_at ASC`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows.map((r) => ({
      author: r.author === 'attorney' ? 'attorney' : 'client',
      body: r.body ?? '',
      sentAt: r.sent_at,
    }))
  })
}
