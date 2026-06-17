import { withActionContext, type ActionContext } from '@exsto/substrate'

// How an upcoming meeting is categorized for the attorney's weekly calendar.
//  - new_consultation: the matter's first consultation (a freshly-booked/opened
//    matter with no draft yet). This is the default for a first meeting.
//  - new_matter: a recently-opened matter (within NEW_MATTER_WINDOW_DAYS) that is
//    still at intake and hasn't reached the consultation-booked stage yet.
//  - existing_project: a matter with prior substantive activity — a draft has
//    been generated, or it has moved into review/approval/close.
export type BookingCategory = 'new_consultation' | 'new_matter' | 'existing_project'

// A matter opened within this many days (and not yet past intake) counts as a
// "new matter" rather than a first consultation. Deterministic + tenant-scoped.
export const NEW_MATTER_WINDOW_DAYS = 14

// Statuses that mean the matter has moved past the first consultation into real
// work. Mutually exclusive with the new_* buckets by precedence below.
const EXISTING_PROJECT_STATUSES = new Set([
  'drafting',
  'in_review',
  'review_pending',
  'approved',
  'engagement_signed',
  'matter_active',
  'closed',
  'matter_closed',
])

// Statuses that mean intake is done but a consultation has not been booked yet.
const PRE_CONSULT_STATUSES = new Set(['intake_submitted', 'inquiry'])

// Pure, deterministic classifier — unit-testable without a database. Precedence:
//   1. prior activity (a draft, or a past-consult status) → existing_project
//   2. recently-opened intake with no consult booked      → new_matter
//   3. otherwise (first consultation booked/scheduled)     → new_consultation
export function classifyBooking(input: {
  status: string
  hasDraft: boolean
  bookedAt: string
  now?: Date
}): BookingCategory {
  if (input.hasDraft || EXISTING_PROJECT_STATUSES.has(input.status)) {
    return 'existing_project'
  }
  const now = input.now ?? new Date()
  const openedMs = new Date(input.bookedAt).getTime()
  const ageDays = Number.isFinite(openedMs) ? (now.getTime() - openedMs) / 86_400_000 : Infinity
  if (PRE_CONSULT_STATUSES.has(input.status) && ageDays <= NEW_MATTER_WINDOW_DAYS) {
    return 'new_matter'
  }
  return 'new_consultation'
}

export interface UpcomingBooking {
  matterEntityId: string
  matterNumber: string
  clientName: string
  serviceKey: string
  scheduledAt: string
  scheduledEnd: string | null
  status: string
  bookedAt: string
  category: BookingCategory
}

// Matters scheduled in the future (from matter.metadata.scheduled_at).
export async function listUpcomingBookings(
  ctx: ActionContext,
  limit = 50,
): Promise<UpcomingBooking[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      matter_entity_id: string
      matter_number: string
      client_name: string | null
      service_key: string | null
      scheduled_at: string
      scheduled_end: string | null
      status: string | null
      booked_at: Date
      has_draft: boolean
    }>(
      `WITH attrs AS (
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
         (SELECT a2.value #>> '{}'
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
            JOIN attrs a2 ON a2.entity_id = r.source_entity_id AND a2.kind_name = 'full_name'
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id
            LIMIT 1) AS client_name,
         (e.metadata->>'service_key') AS service_key,
         (e.metadata->>'scheduled_at') AS scheduled_at,
         (e.metadata->>'scheduled_end') AS scheduled_end,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'matter_status') AS status,
         e.created_at AS booked_at,
         EXISTS (
           SELECT 1 FROM relationship rd
           JOIN relationship_kind_definition rkd2 ON rkd2.id = rd.relationship_kind_id AND rkd2.kind_name = 'draft_of'
           WHERE rd.tenant_id = $1 AND rd.target_entity_id = e.id
         ) AS has_draft
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'matter'
         AND (e.metadata->>'scheduled_at') IS NOT NULL
         AND (e.metadata->>'scheduled_at')::timestamptz >= now() - interval '1 day'
       ORDER BY (e.metadata->>'scheduled_at')::timestamptz ASC
       LIMIT $2`,
      [ctx.tenantId, limit],
    )
    return res.rows.map((r) => {
      const status = r.status ?? ''
      const bookedAt = r.booked_at.toISOString()
      return {
        matterEntityId: r.matter_entity_id,
        matterNumber: r.matter_number,
        clientName: r.client_name ?? '',
        serviceKey: r.service_key ?? '',
        scheduledAt: r.scheduled_at,
        scheduledEnd: r.scheduled_end,
        status,
        bookedAt,
        category: classifyBooking({ status, hasDraft: r.has_draft === true, bookedAt }),
      }
    })
  })
}

// Matter consultations whose scheduled_at falls in [fromIso, toIso). Same shape
// and classification as listUpcomingBookings, but range-bounded (not "upcoming
// only") so a navigable week/day/month calendar can show past and future weeks.
// The dashboard fetches a broad range once and navigates client-side.
export async function listMatterConsultations(
  ctx: ActionContext,
  fromIso: string,
  toIso: string,
): Promise<UpcomingBooking[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      matter_entity_id: string
      matter_number: string
      client_name: string | null
      service_key: string | null
      scheduled_at: string
      scheduled_end: string | null
      status: string | null
      booked_at: Date
      has_draft: boolean
    }>(
      `WITH attrs AS (
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
         (SELECT a2.value #>> '{}'
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
            JOIN attrs a2 ON a2.entity_id = r.source_entity_id AND a2.kind_name = 'full_name'
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id
            LIMIT 1) AS client_name,
         (e.metadata->>'service_key') AS service_key,
         (e.metadata->>'scheduled_at') AS scheduled_at,
         (e.metadata->>'scheduled_end') AS scheduled_end,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'matter_status') AS status,
         e.created_at AS booked_at,
         EXISTS (
           SELECT 1 FROM relationship rd
           JOIN relationship_kind_definition rkd2 ON rkd2.id = rd.relationship_kind_id AND rkd2.kind_name = 'draft_of'
           WHERE rd.tenant_id = $1 AND rd.target_entity_id = e.id
         ) AS has_draft
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'matter'
         AND (e.metadata->>'scheduled_at') IS NOT NULL
         AND (e.metadata->>'scheduled_at')::timestamptz >= $2::timestamptz
         AND (e.metadata->>'scheduled_at')::timestamptz < $3::timestamptz
       ORDER BY (e.metadata->>'scheduled_at')::timestamptz ASC`,
      [ctx.tenantId, fromIso, toIso],
    )
    return res.rows.map((r) => {
      const status = r.status ?? ''
      const bookedAt = r.booked_at.toISOString()
      return {
        matterEntityId: r.matter_entity_id,
        matterNumber: r.matter_number,
        clientName: r.client_name ?? '',
        serviceKey: r.service_key ?? '',
        scheduledAt: r.scheduled_at,
        scheduledEnd: r.scheduled_end,
        status,
        bookedAt,
        category: classifyBooking({ status, hasDraft: r.has_draft === true, bookedAt }),
      }
    })
  })
}

export interface RecentBooking {
  matterEntityId: string
  matterNumber: string
  clientName: string
  serviceKey: string
  scheduledAt: string | null
  status: string
  bookedAt: string
}

export async function listRecentBookings(ctx: ActionContext, limit = 10): Promise<RecentBooking[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      matter_entity_id: string
      matter_number: string
      client_name: string | null
      service_key: string | null
      scheduled_at: string | null
      status: string | null
      booked_at: Date
    }>(
      `WITH attrs AS (
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
         (SELECT a2.value #>> '{}'
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
            JOIN attrs a2 ON a2.entity_id = r.source_entity_id AND a2.kind_name = 'full_name'
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id
            LIMIT 1) AS client_name,
         (e.metadata->>'service_key') AS service_key,
         (e.metadata->>'scheduled_at') AS scheduled_at,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'matter_status') AS status,
         e.created_at AS booked_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'matter'
       ORDER BY e.created_at DESC
       LIMIT $2`,
      [ctx.tenantId, limit],
    )
    return res.rows.map((r) => ({
      matterEntityId: r.matter_entity_id,
      matterNumber: r.matter_number,
      clientName: r.client_name ?? '',
      serviceKey: r.service_key ?? '',
      scheduledAt: r.scheduled_at,
      status: r.status ?? '',
      bookedAt: r.booked_at.toISOString(),
    }))
  })
}
