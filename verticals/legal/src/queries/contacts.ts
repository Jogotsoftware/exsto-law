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

// Four-way CRM bucket (WP2.2), derived from a contact's matter statuses:
//   Active       — ≥1 open (non-closed) matter
//   Prior        — no open matters, but ≥1 reached closed (an open→closed history)
//   Prospective  — no matters closed and none open (a pure lead)
export type CrmBucket = 'active' | 'prospective' | 'prior'
const CLOSED_MATTER_STATUSES = new Set(['closed', 'matter_closed'])
export function deriveCrmBucket(matterStatuses: string[]): CrmBucket {
  const open = matterStatuses.filter((s) => !CLOSED_MATTER_STATUSES.has(s)).length
  if (open > 0) return 'active'
  const closed = matterStatuses.filter((s) => CLOSED_MATTER_STATUSES.has(s)).length
  if (closed > 0) return 'prior'
  return 'prospective'
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
  crmBucket: CrmBucket
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
      `WITH
       -- A contact's matters come from three relationship paths:
       --   • client_of (the LIVE intake path: contact -client_of-> matter),
       --   • matter_has_client (legacy booking: matter -> contact),
       --   • the client parent (contact -contact_of-> client <-matter_of- matter).
       -- client_of was previously omitted, so intake contacts showed no matters and
       -- the wrong CRM status. Union all three, dedup on (contact, matter).
       contact_matter AS (
         SELECT r.source_entity_id AS contact_id, r.target_entity_id AS matter_id
         FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
         WHERE r.tenant_id = $1 AND rkd.kind_name = 'client_of'
           AND (r.valid_to IS NULL OR r.valid_to > now())
         UNION
         SELECT r.target_entity_id AS contact_id, r.source_entity_id AS matter_id
         FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
         WHERE r.tenant_id = $1 AND rkd.kind_name = 'matter_has_client'
         UNION
         SELECT co.source_entity_id AS contact_id, mo.source_entity_id AS matter_id
         FROM relationship co
         JOIN relationship_kind_definition cok ON cok.id = co.relationship_kind_id AND cok.kind_name = 'contact_of'
         JOIN relationship mo ON mo.target_entity_id = co.target_entity_id
         JOIN relationship_kind_definition mok ON mok.id = mo.relationship_kind_id AND mok.kind_name = 'matter_of'
         WHERE co.tenant_id = $1
           AND (co.valid_to IS NULL OR co.valid_to > now())
           AND (mo.valid_to IS NULL OR mo.valid_to > now())
       ),
       matter_rollup AS (
         SELECT cm.contact_id,
                count(*) AS n,
                array_agg(ms.value #>> '{}') FILTER (WHERE ms.value IS NOT NULL) AS statuses,
                max(me.created_at) AS last_at
         FROM contact_matter cm
         JOIN entity me ON me.id = cm.matter_id AND me.tenant_id = $1
         LEFT JOIN LATERAL (
           SELECT a.value
           FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = $1 AND a.entity_id = cm.matter_id AND akd.kind_name = 'matter_status'
             AND (a.valid_to IS NULL OR a.valid_to > now())
           ORDER BY a.valid_from DESC
           LIMIT 1
         ) ms ON true
         GROUP BY cm.contact_id
       )
       -- Contact attributes are written under two historical conventions — the
       -- generic person kinds (full_name/email/phone/company_name, used by the
       -- intake + identity paths) and the contact_-prefixed kinds (matter.open).
       -- Coalesce both so a contact shows its name regardless of which path made
       -- it (the prefixed kind wins when present). Fixes "contacts show no name".
       SELECT
         e.id AS contact_entity_id,
         COALESCE(
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'contact_full_name'
            ORDER BY a.valid_from DESC LIMIT 1),
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'full_name'
            ORDER BY a.valid_from DESC LIMIT 1)
         ) AS full_name,
         COALESCE(
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'contact_email'
            ORDER BY a.valid_from DESC LIMIT 1),
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'email'
            ORDER BY a.valid_from DESC LIMIT 1)
         ) AS email,
         COALESCE(
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'contact_phone'
            ORDER BY a.valid_from DESC LIMIT 1),
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'phone'
            ORDER BY a.valid_from DESC LIMIT 1)
         ) AS phone,
         COALESCE(
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'contact_company_name'
            ORDER BY a.valid_from DESC LIMIT 1),
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_name'
            ORDER BY a.valid_from DESC LIMIT 1)
         ) AS company_name,
         COALESCE(
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'contact_attribution_source'
            ORDER BY a.valid_from DESC LIMIT 1),
           (SELECT a.value #>> '{}' FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'attribution_source'
            ORDER BY a.valid_from DESC LIMIT 1)
         ) AS attribution_source,
         COALESCE(mr.n, 0)::text AS matter_count,
         mr.statuses AS matter_statuses,
         e.created_at AS first_seen_at,
         COALESCE(mr.last_at, e.created_at) AS last_activity_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       LEFT JOIN matter_rollup mr ON mr.contact_id = e.id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'client_contact'
         AND e.status = 'active'
       ORDER BY COALESCE(mr.last_at, e.created_at) DESC`,
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
      crmBucket: deriveCrmBucket(r.matter_statuses ?? []),
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
      `SELECT
         e.id AS matter_entity_id,
         e.name AS matter_number,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'practice_area'
          ORDER BY a.valid_from DESC LIMIT 1) AS service_key,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'matter_status'
            AND (a.valid_to IS NULL OR a.valid_to > now())
          ORDER BY a.valid_from DESC LIMIT 1) AS status,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'matter_summary'
          ORDER BY a.valid_from DESC LIMIT 1) AS summary,
         to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at
       FROM entity e
       WHERE e.tenant_id = $1
         AND e.id IN (
           -- The contact's matters via either live or legacy link, in either
           -- direction: client_of (contact -> matter) or matter_has_client
           -- (matter -> contact). client_of was previously missed here too.
           SELECT CASE WHEN r.source_entity_id = $2 THEN r.target_entity_id ELSE r.source_entity_id END
           FROM relationship r
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
           WHERE r.tenant_id = $1
             AND (r.valid_to IS NULL OR r.valid_to > now())
             AND rkd.kind_name IN ('client_of', 'matter_has_client')
             AND (r.source_entity_id = $2 OR r.target_entity_id = $2)
         )
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, contactEntityId],
    )

    return {
      contactEntityId,
      // Coalesce the two attribute-name conventions (see listContacts) so the
      // contact's details show regardless of which path created it.
      fullName: attrs['contact_full_name'] ?? attrs['full_name'] ?? '',
      email: attrs['contact_email'] ?? attrs['email'] ?? '',
      phone: attrs['contact_phone'] ?? attrs['phone'] ?? null,
      companyName: attrs['contact_company_name'] ?? attrs['company_name'] ?? null,
      attributionSource: attrs['contact_attribution_source'] ?? attrs['attribution_source'] ?? null,
      matterCount: matters.rows.length,
      leadStage: deriveLeadStage(matters.rows.map((r) => r.status ?? 'inquiry')),
      crmBucket: deriveCrmBucket(matters.rows.map((r) => r.status ?? 'inquiry')),
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
