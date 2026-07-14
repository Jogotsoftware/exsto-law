import { withActionContext, type ActionContext } from '@exsto/substrate'
import { signBookingManageToken } from '../api/bookingManageToken.js'
import { resolveClientMatterIds } from '../api/clientIdentity.js'
import { getEngagementConfig, getEngagementStatus } from '../api/engagement.js'
import { getLatestAttributeValue } from '../handlers/common.js'
import { readPortalAssistantEnabled } from '../handlers/engagement.js'
import { listClientDocuments } from '../api/esign.js'
import { loadClientContactEmail } from '../api/clientIdentity.js'
import { listClientMatters, type ClientMatterListItem, type PortalLocale } from './clientPortal.js'
import { listClientInvoices } from './clientBilling.js'
import { listClientNotifications } from './portalNotifications.js'

// CLIENT-PORTAL-UI-1 (WP-1) — ONE read for the portal home: matters, the
// attention band, the rail previews, the unread badge, and the engagement gate
// state. Composes the existing client-safe projections (never new oracles) so
// the home can never show something its detail views would deny.

export interface HomeAttentionConsultation {
  kind: 'consultation'
  matterEntityId: string
  matterNumber: string
  scheduledAt: string
  scheduledEnd: string | null
  manageUrl: string | null
}

export interface HomeAttentionSignature {
  kind: 'signature'
  requestId: string
  documentTitle: string | null
  matterNumber: string | null
}

export type HomeAttentionItem = HomeAttentionConsultation | HomeAttentionSignature

export interface HomeMessagePreview {
  matterEntityId: string
  author: 'client' | 'attorney'
  body: string
  sentAt: string
}

export interface PortalHomeSummary {
  firstName: string | null
  matters: ClientMatterListItem[]
  attention: HomeAttentionItem[]
  messagesPreview: HomeMessagePreview[]
  billing: { dueTotal: string; dueCount: number; nextDueDate: string | null; currency: string }
  unreadCount: number
  engagement: {
    accepted: boolean
    acceptedAt: string | null
    rate: string | null
    termsVersion: number | null
    configured: boolean
  }
  assistantEnabled: boolean
}

// Upcoming, non-cancelled consultations across the client's matters — the same
// truth the per-matter timeline card renders, lifted to the cross-matter band.
async function listUpcomingConsultations(
  ctx: ActionContext,
  matterIds: string[],
): Promise<HomeAttentionConsultation[]> {
  if (matterIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      id: string
      name: string
      scheduled_at: string
      scheduled_end: string | null
      status: string | null
    }>(
      `SELECT e.id, e.name,
              e.metadata ->> 'scheduled_at' AS scheduled_at,
              e.metadata ->> 'scheduled_end' AS scheduled_end,
              (SELECT a.value #>> '{}'
                 FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                 WHERE a.tenant_id = $1 AND a.entity_id = e.id
                   AND akd.kind_name = 'matter_status'
                 ORDER BY a.valid_from DESC LIMIT 1) AS status
       FROM entity e
       WHERE e.tenant_id = $1 AND e.id = ANY($2::uuid[])
         AND e.status = 'active'
         AND e.metadata ->> 'scheduled_at' IS NOT NULL`,
      [ctx.tenantId, matterIds],
    )
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? '').replace(/\/$/, '')
    const out: HomeAttentionConsultation[] = []
    for (const row of res.rows) {
      const at = Date.parse(row.scheduled_at)
      if (!Number.isFinite(at) || at <= Date.now()) continue
      if (row.status === 'consultation_cancelled') continue
      let manageUrl: string | null = null
      if (baseUrl) {
        try {
          const tok = signBookingManageToken({ matterEntityId: row.id, tenantId: ctx.tenantId })
          manageUrl = `${baseUrl}/book/manage/${tok}`
        } catch {
          manageUrl = null // signing secret unset — degrade to no manage link
        }
      }
      out.push({
        kind: 'consultation',
        matterEntityId: row.id,
        matterNumber: row.name,
        scheduledAt: row.scheduled_at,
        scheduledEnd: row.scheduled_end,
        manageUrl,
      })
    }
    out.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    return out
  })
}

// The two newest portal-thread messages across ALL the client's matters — the
// rail preview. Same projection rules as getMatterThread (author/body/sentAt).
async function listRecentMessages(
  ctx: ActionContext,
  matterIds: string[],
): Promise<HomeMessagePreview[]> {
  if (matterIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      matter_id: string
      author: string | null
      body: string | null
      sent_at: string
    }>(
      `SELECT (SELECT rid FROM unnest(t.related_entity_ids) AS rid
                WHERE rid = ANY($2::uuid[]) LIMIT 1) AS matter_id,
              m.payload->>'author' AS author,
              b.body AS body,
              to_char(m.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS sent_at
       FROM communication_thread t
       JOIN communication_message m ON m.tenant_id = t.tenant_id AND m.thread_id = t.id
       LEFT JOIN content_blob b ON b.id = m.body_blob_id
       WHERE t.tenant_id = $1
         AND t.participants->>'channel' = 'portal'
         AND t.related_entity_ids && $2::uuid[]
       ORDER BY m.occurred_at DESC, m.recorded_at DESC
       LIMIT 2`,
      [ctx.tenantId, matterIds],
    )
    return res.rows.map((r) => ({
      matterEntityId: r.matter_id,
      author: r.author === 'attorney' ? ('attorney' as const) : ('client' as const),
      body: r.body ?? '',
      sentAt: r.sent_at,
    }))
  })
}

const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2)

export async function getPortalHomeSummary(
  ctx: ActionContext,
  clientContactId: string,
  locale: PortalLocale = 'en',
): Promise<PortalHomeSummary> {
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  const email = await loadClientContactEmail(ctx.tenantId, clientContactId)

  const [fullName, matters, consultations, esignDocs, invoices, feed, engagementStatus, config] =
    await Promise.all([
      withActionContext(ctx, (client) =>
        getLatestAttributeValue<string>(client, ctx.tenantId, clientContactId, 'full_name'),
      ),
      listClientMatters(ctx, clientContactId, locale),
      listUpcomingConsultations(ctx, matterIds),
      email
        ? listClientDocuments({ tenantId: ctx.tenantId, clientContactId, email, matterIds })
        : Promise.resolve([]),
      listClientInvoices(ctx, clientContactId),
      listClientNotifications(ctx, clientContactId),
      getEngagementStatus(ctx, clientContactId),
      getEngagementConfig(ctx),
    ])

  const signatures: HomeAttentionSignature[] = esignDocs
    .filter((d) => d.state === 'awaiting_you')
    .map((d) => ({
      kind: 'signature' as const,
      requestId: d.requestId,
      documentTitle: d.documentTitle,
      matterNumber: d.matterNumber,
    }))

  const due = invoices.filter((inv) => inv.status === 'due')
  const dueTotal = money(due.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0))
  const nextDueDate =
    due
      .map((inv) => inv.dueDate)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null

  // WP-7: the assistant flag lives on the client PARENT entity (contact_of),
  // same home as portal_scheduling_billable.
  const assistantEnabled = await withActionContext(ctx, async (client) => {
    const parent = await client.query<{ id: string }>(
      `SELECT r.target_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.source_entity_id = $2
         AND rkd.kind_name = 'contact_of'
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY r.recorded_at DESC LIMIT 1`,
      [ctx.tenantId, clientContactId],
    )
    const parentId = parent.rows[0]?.id
    if (!parentId) return false
    return readPortalAssistantEnabled(client, ctx.tenantId, parentId)
  })

  return {
    firstName: fullName ? (fullName.trim().split(/\s+/)[0] ?? null) : null,
    matters,
    attention: [...consultations, ...signatures],
    messagesPreview: await listRecentMessages(ctx, matterIds),
    billing: { dueTotal, dueCount: due.length, nextDueDate, currency: 'USD' },
    unreadCount: feed.unreadCount,
    engagement: {
      accepted: engagementStatus.accepted,
      acceptedAt: engagementStatus.acceptedAt,
      rate: engagementStatus.accepted ? engagementStatus.rate : config.rate,
      termsVersion: engagementStatus.accepted ? engagementStatus.termsVersion : config.termsVersion,
      configured: config.configured,
    },
    assistantEnabled,
  }
}
