import { withActionContext, type ActionContext } from '@exsto/substrate'

export interface UpcomingBooking {
  matterEntityId: string
  matterNumber: string
  clientName: string
  serviceKey: string
  scheduledAt: string
  scheduledEnd: string | null
  status: string
  bookedAt: string
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
         e.created_at AS booked_at
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
    return res.rows.map((r) => ({
      matterEntityId: r.matter_entity_id,
      matterNumber: r.matter_number,
      clientName: r.client_name ?? '',
      serviceKey: r.service_key ?? '',
      scheduledAt: r.scheduled_at,
      scheduledEnd: r.scheduled_end,
      status: r.status ?? '',
      bookedAt: r.booked_at.toISOString(),
    }))
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
