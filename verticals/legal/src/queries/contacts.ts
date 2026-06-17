import { withActionContext, type ActionContext } from '@exsto/substrate'

// CRM lead pipeline stage, derived (not stored) from a contact's matter statuses
// so it stays in sync without a separate field to maintain. A contact with any
// open (non-closed) matter sits at that matter's furthest stage; only when every
// matter is closed do they become 'closed'; no matters yet ⇒ 'prospect'.
export type LeadStage = 'prospect' | 'consulted' | 'engaged' | 'active' | 'closed'

// Order = pipeline progression; index is the rank used to pick the furthest stage.
export const LEAD_STAGES: readonly LeadStage[] = [
  'prospect',
  'consulted',
  'engaged',
  'active',
  'closed',
]

const OPEN_STAGE_ORDER: LeadStage[] = ['prospect', 'consulted', 'engaged', 'active']

// Map a single matter_status to a pipeline stage.
export function statusToStage(status: string): LeadStage {
  switch (status) {
    case 'matter_closed':
    case 'closed':
      return 'closed'
    case 'engagement_signed':
    case 'matter_active':
      return 'active'
    case 'drafting':
    case 'in_review':
    case 'review_pending':
    case 'approved':
      return 'engaged'
    case 'consultation_scheduled':
    case 'consultation_completed':
      return 'consulted'
    default:
      // inquiry / questionnaire_* / intake_submitted / unknown
      return 'prospect'
  }
}

// Derive a contact's pipeline stage from all their matters' statuses.
export function deriveLeadStage(matterStatuses: string[]): LeadStage {
  const stages = matterStatuses.map(statusToStage)
  const open = stages.filter((s) => s !== 'closed')
  if (open.length === 0) return matterStatuses.length > 0 ? 'closed' : 'prospect'
  let best: LeadStage = 'prospect'
  for (const s of open) {
    if (OPEN_STAGE_ORDER.indexOf(s) > OPEN_STAGE_ORDER.indexOf(best)) best = s
  }
  return best
}

export interface ContactSummary {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  companyName: string | null
  attributionSource: string | null
  matterCount: number
  leadStage: LeadStage
  firstSeenAt: string
  lastActivityAt: string
}

export interface ContactMatterRow {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  status: string
  summary: string
  createdAt: string
}

export interface ContactDetail extends ContactSummary {
  matters: ContactMatterRow[]
}

export async function listContacts(ctx: ActionContext): Promise<ContactSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      contact_entity_id: string
      full_name: string | null
      email: string | null
      phone: string | null
      company_name: string | null
      attribution_source: string | null
      matter_count: string
      matter_statuses: string[] | null
      first_seen_at: Date
      last_activity_at: Date
    }>(
      `WITH attrs AS (
         SELECT DISTINCT ON (a.entity_id, akd.kind_name)
           a.entity_id, akd.kind_name, a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         WHERE a.tenant_id = $1
         ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
       ),
       matter_counts AS (
         SELECT r.target_entity_id AS contact_id,
                count(*) AS n,
                max(r.recorded_at) AS last_at
         FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
         WHERE r.tenant_id = $1 AND rkd.kind_name = 'matter_has_client'
         GROUP BY r.target_entity_id
       ),
       matter_statuses AS (
         SELECT r.target_entity_id AS contact_id,
                array_agg(ms.value #>> '{}') FILTER (WHERE ms.value IS NOT NULL) AS statuses
         FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'matter_has_client'
         LEFT JOIN attrs ms ON ms.entity_id = r.source_entity_id AND ms.kind_name = 'matter_status'
         WHERE r.tenant_id = $1
         GROUP BY r.target_entity_id
       )
       SELECT
         e.id AS contact_entity_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'contact_full_name')        AS full_name,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'contact_email')            AS email,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'contact_phone')            AS phone,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'contact_company_name')     AS company_name,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'contact_attribution_source') AS attribution_source,
         COALESCE(mc.n, 0)::text AS matter_count,
         mstat.statuses AS matter_statuses,
         e.created_at AS first_seen_at,
         COALESCE(mc.last_at, e.created_at) AS last_activity_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       LEFT JOIN matter_counts mc ON mc.contact_id = e.id
       LEFT JOIN matter_statuses mstat ON mstat.contact_id = e.id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'client_contact'
         AND e.status = 'active'
       ORDER BY COALESCE(mc.last_at, e.created_at) DESC`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      contactEntityId: r.contact_entity_id,
      fullName: r.full_name ?? '',
      email: r.email ?? '',
      phone: r.phone,
      companyName: r.company_name,
      attributionSource: r.attribution_source,
      matterCount: Number(r.matter_count),
      leadStage: deriveLeadStage(r.matter_statuses ?? []),
      firstSeenAt: r.first_seen_at.toISOString(),
      lastActivityAt: r.last_activity_at.toISOString(),
    }))
  })
}

export async function getContact(
  ctx: ActionContext,
  contactEntityId: string,
): Promise<ContactDetail | null> {
  return withActionContext(ctx, async (client) => {
    const base = await client.query<{ id: string; created_at: Date }>(
      `SELECT e.id, e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'client_contact'`,
      [ctx.tenantId, contactEntityId],
    )
    if (!base.rows[0]) return null
    const baseCreatedAtIso = base.rows[0].created_at.toISOString()

    const attrRes = await client.query<{ kind_name: string; value: unknown }>(
      `SELECT DISTINCT ON (akd.kind_name) akd.kind_name, a.value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2
       ORDER BY akd.kind_name, a.valid_from DESC`,
      [ctx.tenantId, contactEntityId],
    )
    const attrs: Record<string, string> = {}
    for (const row of attrRes.rows) {
      const v = row.value
      attrs[row.kind_name] = typeof v === 'string' ? v : JSON.stringify(v)
    }

    const matters = await client.query<{
      matter_entity_id: string
      matter_number: string
      service_key: string | null
      status: string | null
      summary: string | null
      created_at: string
    }>(
      `WITH matter_attrs AS (
         SELECT DISTINCT ON (a.entity_id, akd.kind_name)
           a.entity_id, akd.kind_name, a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         WHERE a.tenant_id = $1
         ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
       )
       SELECT
         e.id AS matter_entity_id,
         e.name AS matter_number,
         (SELECT value #>> '{}' FROM matter_attrs WHERE entity_id = e.id AND kind_name = 'practice_area') AS service_key,
         (SELECT value #>> '{}' FROM matter_attrs WHERE entity_id = e.id AND kind_name = 'matter_status') AS status,
         (SELECT value #>> '{}' FROM matter_attrs WHERE entity_id = e.id AND kind_name = 'matter_summary') AS summary,
         to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
       FROM entity e
       JOIN relationship r ON r.source_entity_id = e.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1
         AND r.target_entity_id = $2
         AND rkd.kind_name = 'matter_has_client'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, contactEntityId],
    )

    return {
      contactEntityId,
      fullName: attrs['contact_full_name'] ?? '',
      email: attrs['contact_email'] ?? '',
      phone: attrs['contact_phone'] ?? null,
      companyName: attrs['contact_company_name'] ?? null,
      attributionSource: attrs['contact_attribution_source'] ?? null,
      matterCount: matters.rows.length,
      leadStage: deriveLeadStage(matters.rows.map((r) => r.status ?? 'inquiry')),
      firstSeenAt: baseCreatedAtIso,
      lastActivityAt: matters.rows[0]?.created_at ?? baseCreatedAtIso,
      matters: matters.rows.map((r) => ({
        matterEntityId: r.matter_entity_id,
        matterNumber: r.matter_number,
        serviceKey: r.service_key ?? '',
        status: r.status ?? 'inquiry',
        summary: r.summary ?? '',
        createdAt: r.created_at,
      })),
    }
  })
}
