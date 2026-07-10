import { withActionContext, type ActionContext } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { signBookingManageToken } from '../api/bookingManageToken.js'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { stageByKey, clientLabel } from '../lifecycle/resolve.js'

// Client-portal READ projection. This is DELIBERATELY a separate, narrow surface
// from queries/history.ts (getMatterHistory): that one exposes internal actions,
// actor names, intent/autonomy tiers, reasoning-trace flags, transcripts and
// review notes — none of which a client may ever see. This module returns only a
// friendly status label and a WHITELISTED set of lifecycle milestones.
//
// Security posture:
//   • Tenant-scoped via withActionContext (RLS engaged).
//   • Authorization (this client may see THIS matter) is enforced UPSTREAM in
//     the authed route against the session's matterIds, BEFORE these run. These
//     functions assume the matter is already authorized; they add no oracle of
//     their own (a stranger's matter id simply returns an empty timeline).
//   • Event-kind allowlist: only the kinds in CLIENT_VISIBLE_EVENT_KINDS appear.
//     Internal/research/draft.requested/draft.failed etc. are excluded by
//     omission — default-deny, not deny-list.

// The ONLY event kinds a client may see, mapped to client-facing labels. Adding
// a kind here is an intentional disclosure decision. draft.completed becomes a
// generic "a document is ready" — the client portal never names internal docs.
const CLIENT_VISIBLE_EVENT_KINDS: ReadonlyMap<string, string> = new Map([
  ['matter.opened', 'Matter opened'],
  ['consultation.booked', 'Consultation booked'],
  ['consultation.rescheduled', 'Consultation rescheduled'],
  ['consultation.cancelled', 'Consultation cancelled'],
  ['draft.completed', 'A document is ready'],
])

// Friendly, client-facing labels for the internal matter_status values. Unknown
// statuses fall back to a generic "In progress" rather than leaking the raw key.
const STATUS_LABELS: ReadonlyMap<string, string> = new Map([
  ['intake_submitted', 'Intake received'],
  ['consultation_booked', 'Consultation booked'],
  ['consultation_scheduled', 'Consultation scheduled'],
  ['consultation_completed', 'Consultation completed'],
  ['drafting', 'Preparing your documents'],
  ['draft_ready', 'Document ready'],
  ['in_review', 'Under attorney review'],
  ['completed', 'Completed'],
  ['closed', 'Closed'],
])

function statusLabel(statusKey: string): string {
  return STATUS_LABELS.get(statusKey) ?? 'In progress'
}

// PORTAL-1 (WP2): the composed workflow's CLIENT-SAFE stage label, never the
// internal stage key. Resolves the matter's workflow instance and reads the
// current stage's client_label (falling back to the stage label, then to the
// STATUS_LABELS map, then to a generic 'In progress' — raw keys never leak).
async function resolveClientStageLabel(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
  statusKey: string,
): Promise<string> {
  try {
    const instance = await getWorkflowInstanceForMatter(client, tenantId, matterEntityId)
    if (instance) {
      let graph =
        instance.statesOverride && instance.statesOverride.length > 0 ? instance.statesOverride : []
      if (graph.length === 0) {
        const bound = await resolveBoundWorkflowById(
          client,
          tenantId,
          instance.workflowDefinitionId,
        )
        graph = bound?.graph ?? []
      }
      const stage = stageByKey(graph, instance.currentState)
      if (stage) return clientLabel(stage)
    }
  } catch {
    // fall through to the static map
  }
  return statusLabel(statusKey)
}

// The service's client-facing name: client_display_name when the column exists
// (UI-BUILDER-FIX-1 adds it), else display_name — read via to_jsonb so this
// works before AND after that migration lands.
async function resolveServiceClientName(
  client: DbClient,
  tenantId: string,
  serviceKey: string | null,
): Promise<string | null> {
  if (!serviceKey) return null
  const res = await client.query<{ name: string | null }>(
    `SELECT COALESCE(to_jsonb(wd) ->> 'client_display_name', wd.display_name) AS name
     FROM workflow_definition wd
     WHERE wd.tenant_id = $1 AND wd.kind_name = $2 AND wd.status = 'active'
     ORDER BY wd.version DESC LIMIT 1`,
    [tenantId, serviceKey],
  )
  return res.rows[0]?.name ?? null
}

export interface ClientMatterMilestone {
  key: string
  label: string
  occurredAt: string
}

export interface ClientMatterTimeline {
  matterNumber: string
  statusKey: string
  statusLabel: string
  /** The service's client-facing name (client_display_name → display_name). */
  serviceLabel: string | null
  scheduledAt: string | null
  /** True when there's an upcoming, non-cancelled consultation to manage. */
  canManageEvent: boolean
  /** Token-gated /book/manage link to reschedule or cancel (when manageable). */
  manageUrl: string | null
  milestones: ClientMatterMilestone[]
}

export interface ClientMatterListItem {
  matterEntityId: string
  matterNumber: string
  statusKey: string
  statusLabel: string
  serviceLabel: string | null
  /** Archived history is shown, marked — not hidden. */
  archived: boolean
}

// Client-safe timeline for ONE matter. Returns null if the matter doesn't exist
// in the tenant (the route has already verified the caller is authorized for it).
export async function getClientMatterTimeline(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<ClientMatterTimeline | null> {
  return withActionContext(ctx, async (client) => {
    const baseRes = await client.query<{
      id: string
      name: string
      scheduled_at: string | null
    }>(
      `SELECT e.id, e.name, e.metadata->>'scheduled_at' AS scheduled_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2
         AND ekd.kind_name = 'matter' AND e.status = 'active'`,
      [ctx.tenantId, matterEntityId],
    )
    const base = baseRes.rows[0]
    if (!base) return null

    // Current matter_status (latest valid_from).
    const statusRes = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'matter_status'
       ORDER BY a.valid_from DESC
       LIMIT 1`,
      [ctx.tenantId, matterEntityId],
    )
    const statusKey = statusRes.rows[0]?.value ?? 'intake_submitted'
    const stageLabel = await resolveClientStageLabel(
      client,
      ctx.tenantId,
      matterEntityId,
      statusKey,
    )
    const serviceKeyRes = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'service_key'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [ctx.tenantId, matterEntityId],
    )
    const serviceLabel = await resolveServiceClientName(
      client,
      ctx.tenantId,
      serviceKeyRes.rows[0]?.value ?? null,
    )

    // Whitelisted milestones only. We filter to the allowlist in SQL (so the
    // internal kinds never even leave the DB) and label them in app code. No
    // actor, intent, autonomy, reasoning trace, payload, or transcript is read.
    const eventRes = await client.query<{
      kind_name: string
      occurred_at: string
    }>(
      `SELECT ekd.kind_name,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS occurred_at
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND (e.primary_entity_id = $2::uuid OR $2::uuid = ANY(e.secondary_entity_ids))
         AND ekd.kind_name = ANY($3::text[])
       ORDER BY e.occurred_at ASC`,
      [ctx.tenantId, matterEntityId, [...CLIENT_VISIBLE_EVENT_KINDS.keys()]],
    )

    const milestones: ClientMatterMilestone[] = eventRes.rows.map((r) => ({
      key: r.kind_name,
      label: CLIENT_VISIBLE_EVENT_KINDS.get(r.kind_name) ?? r.kind_name,
      occurredAt: r.occurred_at,
    }))

    // Upcoming, non-cancelled consultation → offer a token-gated manage link
    // (the same self-service /book/manage page the confirmation email uses).
    const upcoming =
      Boolean(base.scheduled_at) &&
      Date.parse(base.scheduled_at as string) > Date.now() &&
      statusKey !== 'consultation_cancelled'
    let manageUrl: string | null = null
    if (upcoming) {
      const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? '').replace(/\/$/, '')
      if (baseUrl) {
        try {
          const tok = signBookingManageToken({ matterEntityId, tenantId: ctx.tenantId })
          manageUrl = `${baseUrl}/book/manage/${tok}`
        } catch {
          manageUrl = null // signing secret unset — degrade to no manage link
        }
      }
    }

    return {
      matterNumber: base.name,
      statusKey,
      statusLabel: stageLabel,
      serviceLabel,
      scheduledAt: base.scheduled_at,
      canManageEvent: upcoming,
      manageUrl,
      milestones,
    }
  })
}

// The matter switcher list for a signed-in client. Returns ONLY the matters the
// given client_contact is client_of (the route passes the cookie's
// clientContactId — never a body value). Tenant-scoped. No client names, no
// attorney data — just enough to render the switcher.
export async function listClientMatters(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientMatterListItem[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      matter_id: string
      matter_number: string
      entity_status: string
      status: string | null
      service_key: string | null
    }>(
      `SELECT m.id AS matter_id, m.name AS matter_number, m.status AS entity_status,
              (SELECT a.value #>> '{}'
                 FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                 WHERE a.tenant_id = $1 AND a.entity_id = m.id
                   AND akd.kind_name = 'matter_status'
                 ORDER BY a.valid_from DESC LIMIT 1) AS status,
              (SELECT a.value #>> '{}'
                 FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                 WHERE a.tenant_id = $1 AND a.entity_id = m.id
                   AND akd.kind_name = 'service_key'
                 ORDER BY a.valid_from DESC LIMIT 1) AS service_key
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity m ON m.id = r.target_entity_id
       JOIN entity_kind_definition mekd ON mekd.id = m.entity_kind_id
       WHERE r.tenant_id = $1
         AND r.source_entity_id = $2
         AND rkd.kind_name = 'client_of'
         AND (r.valid_to IS NULL OR r.valid_to > now())
         AND mekd.kind_name = 'matter'
         AND m.status IN ('active', 'archived')
       ORDER BY (m.status = 'archived'), m.created_at DESC`,
      [ctx.tenantId, clientContactId],
    )
    const items: ClientMatterListItem[] = []
    for (const row of res.rows) {
      const statusKey = row.status ?? 'intake_submitted'
      items.push({
        matterEntityId: row.matter_id,
        matterNumber: row.matter_number,
        statusKey,
        statusLabel: await resolveClientStageLabel(client, ctx.tenantId, row.matter_id, statusKey),
        serviceLabel: await resolveServiceClientName(client, ctx.tenantId, row.service_key),
        archived: row.entity_status === 'archived',
      })
    }
    return items
  })
}
