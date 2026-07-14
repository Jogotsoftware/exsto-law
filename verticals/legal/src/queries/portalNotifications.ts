import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { resolveClientMatterIds } from '../api/clientIdentity.js'
import { listApprovedClientDocuments } from './clientDocuments.js'
import { listClientInvoices } from './clientBilling.js'

// CLIENT-PORTAL-UI-1 (WP-3) — the notifications feed: things that HAPPENED for
// this client, as a READ PROJECTION over the existing ledgers. No parallel
// notification pipeline, no new fact writes for the feed itself.
//
// Boundary rule (founder decision 3): notifications ≠ the attention band. A
// signature request APPEARING here is "what's new"; the signature still
// awaiting the client renders in the home attention band with different copy.
//
// Client-copy doctrine: an item carries ONLY a type key + client-safe params
// (matter number, dates, invoice number). The UI maps type → copy through the
// i18n layer — no internal kind keys, subjects, or step names ever leave here.
//
// Read-state is APPEND-ONLY (portal.notification.read watermark actions):
// unread = items newer than the latest watermark. No UPDATE, no DELETE.

export type PortalNotificationType =
  | 'message' // new attorney message
  | 'document' // a document is ready in the portal
  | 'esign_request' // a signature request was sent
  | 'invoice' // an invoice was issued
  | 'booking_confirmed'
  | 'booking_changed'
  | 'booking_cancelled'

export interface PortalNotification {
  /** Stable id for the feed row (the underlying ledger row's id). */
  id: string
  type: PortalNotificationType
  occurredAt: string
  matterEntityId: string | null
  matterNumber: string | null
  /** Client-safe reference for the link target (invoice number, version id…). */
  ref: string | null
  unread: boolean
}

export interface PortalNotificationFeed {
  items: PortalNotification[]
  unreadCount: number
  lastReadAt: string | null
}

const FEED_LIMIT = 50

// The latest read watermark for this contact (payload.read_at of the newest
// portal.notification.read action). Joined by action_kind_id — one kind row per
// action, so the double-seed pattern cannot duplicate rows here.
async function readWatermark(ctx: ActionContext, clientContactId: string): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ read_at: string | null }>(
      `SELECT a.payload ->> 'read_at' AS read_at
       FROM action a
       JOIN action_kind_definition k ON k.id = a.action_kind_id
       WHERE a.tenant_id = $1
         AND k.kind_name = 'portal.notification.read'
         AND a.payload ->> 'client_contact_id' = $2
       ORDER BY a.recorded_at DESC
       LIMIT 1`,
      [ctx.tenantId, clientContactId],
    )
    return res.rows[0]?.read_at ?? null
  })
}

interface LedgerItem {
  id: string
  type: PortalNotificationType
  occurredAt: string
  matterEntityId: string | null
  matterNumber: string | null
  ref: string | null
}

// Attorney messages + e-sign sends + booking changes, straight off the action
// ledger, scoped to the client's own matters (and, for standalone portal
// bookings, the contact itself — scheduleClientTime books contact-as-subject).
async function listLedgerItems(
  ctx: ActionContext,
  clientContactId: string,
  matterIds: string[],
): Promise<LedgerItem[]> {
  const scopeIds = [...matterIds, clientContactId]
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      id: string
      kind_name: string
      matter_id: string | null
      matter_number: string | null
      occurred_at: string
    }>(
      `SELECT a.id, k.kind_name,
              m.id AS matter_id,
              COALESCE(m.name, a.payload ->> 'matter_number') AS matter_number,
              to_char(a.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS occurred_at
       FROM action a
       JOIN action_kind_definition k ON k.id = a.action_kind_id
       LEFT JOIN entity m ON m.id = (a.payload ->> 'matter_entity_id')::uuid
       WHERE a.tenant_id = $1
         AND k.kind_name = ANY($2::text[])
         AND (a.payload ->> 'matter_entity_id')::uuid = ANY($3::uuid[])
       ORDER BY a.recorded_at DESC
       LIMIT $4`,
      [
        ctx.tenantId,
        [
          'attorney.message.post',
          'esign.send',
          'booking.create',
          'booking.update',
          'booking.cancel',
        ],
        scopeIds,
        FEED_LIMIT,
      ],
    )
    const typeOf = (kind: string): PortalNotificationType => {
      switch (kind) {
        case 'attorney.message.post':
          return 'message'
        case 'esign.send':
          return 'esign_request'
        case 'booking.update':
          return 'booking_changed'
        case 'booking.cancel':
          return 'booking_cancelled'
        default:
          return 'booking_confirmed'
      }
    }
    return res.rows.map((r) => ({
      id: r.id,
      type: typeOf(r.kind_name),
      occurredAt: r.occurred_at,
      // Standalone bookings carry a B-… booking ref as matter_number; matters
      // resolve to their real matter number. Either is client-safe.
      matterEntityId: matterIds.includes(r.matter_id ?? '') ? r.matter_id : null,
      matterNumber: r.matter_number,
      ref: null,
    }))
  })
}

// One feed, merged newest-first: ledger items + document-ready items (the same
// projection the Documents tab lists, so the feed can never announce a document
// the client cannot see) + issued invoices.
export async function listClientNotifications(
  ctx: ActionContext,
  clientContactId: string,
): Promise<PortalNotificationFeed> {
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  const [ledger, approvedDocs, invoices, lastReadAt] = await Promise.all([
    listLedgerItems(ctx, clientContactId, matterIds),
    listApprovedClientDocuments(ctx, clientContactId),
    listClientInvoices(ctx, clientContactId),
    readWatermark(ctx, clientContactId),
  ])

  const items: LedgerItem[] = [
    ...ledger,
    ...approvedDocs.map((d) => ({
      id: d.documentVersionId,
      type: 'document' as const,
      occurredAt: d.approvedAt,
      matterEntityId: d.matterEntityId,
      matterNumber: d.matterNumber,
      ref: d.documentVersionId,
    })),
    ...invoices
      .filter((inv) => inv.issuedDate)
      .map((inv) => ({
        id: inv.invoiceEntityId,
        type: 'invoice' as const,
        occurredAt: inv.issuedDate as string,
        matterEntityId: null,
        matterNumber: null,
        ref: inv.invoiceNumber,
      })),
  ]

  items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  const capped = items.slice(0, FEED_LIMIT)
  const readMs = lastReadAt ? Date.parse(lastReadAt) : 0
  const withRead = capped.map((it) => ({ ...it, unread: Date.parse(it.occurredAt) > readMs }))
  return {
    items: withRead,
    unreadCount: withRead.filter((it) => it.unread).length,
    lastReadAt,
  }
}

// Mark everything read "now" — an append-only watermark action attributed to the
// client's own actor. ctx MUST be the client's session context.
export async function markClientNotificationsRead(
  ctx: ActionContext,
  clientContactId: string,
): Promise<{ readAt: string }> {
  const readAt = new Date().toISOString()
  await submitAction(ctx, {
    actionKindName: 'portal.notification.read',
    intentKind: 'adjustment',
    payload: { client_contact_id: clientContactId, read_at: readAt },
  })
  return { readAt }
}
