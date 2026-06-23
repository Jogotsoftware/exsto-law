import { withActionContext, type ActionContext } from '@exsto/substrate'

// Reads over client_request entities (migration 0092). Two surfaces:
//   • the CLIENT's own requests (portal), scoped to their matters,
//   • the attorney INBOX of active (non-terminal) requests across the firm.
// Both project from the request's attributes + its request_of (matter) /
// request_from (client_contact) relationships.

const ATTRS_CTE = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name)
      a.entity_id, akd.kind_name, a.value
    FROM attribute a
    JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1
    ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )`

export type RequestStatus = 'requested' | 'accepted' | 'in_progress' | 'fulfilled' | 'declined'
const ACTIVE_STATUSES = ['requested', 'accepted', 'in_progress']

export interface ClientRequestSummary {
  requestEntityId: string
  requestType: string
  status: string
  description: string
  amount: string
  currency: string
  priceBasis: string
  createdAt: string
}

export interface AttorneyRequestItem extends ClientRequestSummary {
  matterEntityId: string | null
  matterNumber: string | null
  clientName: string
}

// The columns common to both projections (request head + matter/client joins).
const SELECT_COLS = `
  e.id AS request_id,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'request_type')        AS request_type,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'request_status')      AS status,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'request_description') AS description,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'request_price_amount') AS amount,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'request_currency')    AS currency,
  (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'request_price_basis') AS price_basis,
  e.created_at`

interface HeadRow {
  request_id: string
  request_type: string | null
  status: string | null
  description: string | null
  amount: string | null
  currency: string | null
  price_basis: string | null
  created_at: Date
}

function toSummary(r: HeadRow): ClientRequestSummary {
  return {
    requestEntityId: r.request_id,
    requestType: r.request_type ?? '',
    status: r.status ?? 'requested',
    description: r.description ?? '',
    amount: r.amount ?? '0.00',
    currency: r.currency ?? 'USD',
    priceBasis: r.price_basis ?? '',
    createdAt: r.created_at.toISOString(),
  }
}

// The signed-in client's own requests (newest first), via the request_from link.
export async function listClientRequests(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientRequestSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<HeadRow>(
      `${ATTRS_CTE}
       SELECT ${SELECT_COLS}
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       JOIN relationship r ON r.source_entity_id = e.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'client_request' AND e.status = 'active'
         AND rkd.kind_name = 'client_request_from' AND r.target_entity_id = $2
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, clientContactId],
    )
    return res.rows.map(toSummary)
  })
}

// The attorney inbox: active (non-terminal) requests across the firm, with the
// matter number and the requesting client's name. Newest first.
export async function listPendingRequests(ctx: ActionContext): Promise<AttorneyRequestItem[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<
      HeadRow & {
        matter_id: string | null
        matter_number: string | null
        client_name: string | null
      }
    >(
      `${ATTRS_CTE}
       SELECT ${SELECT_COLS},
         mat.id AS matter_id,
         mat.name AS matter_number,
         COALESCE(
           (SELECT value #>> '{}' FROM attrs WHERE entity_id = con.id AND kind_name = 'contact_full_name'),
           (SELECT value #>> '{}' FROM attrs WHERE entity_id = con.id AND kind_name = 'full_name'),
           (SELECT value #>> '{}' FROM attrs WHERE entity_id = con.id AND kind_name = 'email')
         ) AS client_name
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       LEFT JOIN relationship rof ON rof.source_entity_id = e.id
         AND (rof.valid_to IS NULL OR rof.valid_to > now())
         AND rof.relationship_kind_id = (SELECT id FROM relationship_kind_definition WHERE tenant_id = $1 AND kind_name = 'client_request_of')
       LEFT JOIN entity mat ON mat.id = rof.target_entity_id
       LEFT JOIN relationship rfr ON rfr.source_entity_id = e.id
         AND (rfr.valid_to IS NULL OR rfr.valid_to > now())
         AND rfr.relationship_kind_id = (SELECT id FROM relationship_kind_definition WHERE tenant_id = $1 AND kind_name = 'client_request_from')
       LEFT JOIN entity con ON con.id = rfr.target_entity_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'client_request' AND e.status = 'active'
         AND (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'request_status')
             = ANY($2::text[])
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, ACTIVE_STATUSES],
    )
    return res.rows.map((r) => ({
      ...toSummary(r),
      matterEntityId: r.matter_id,
      matterNumber: r.matter_number,
      clientName: r.client_name ?? '',
    }))
  })
}

export interface RequestRecord {
  requestEntityId: string
  requestType: string
  status: string
  amount: string
  currency: string
  description: string
  matterEntityId: string | null
  clientContactId: string | null
}

// One request with the fields the fulfilment path needs (amount + matter for the
// fee, type for the description). Tenant-scoped.
export async function getRequestRecord(
  ctx: ActionContext,
  requestEntityId: string,
): Promise<RequestRecord | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<
      HeadRow & { matter_id: string | null; contact_id: string | null }
    >(
      `${ATTRS_CTE}
       SELECT ${SELECT_COLS},
         (SELECT r.target_entity_id FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.source_entity_id = e.id AND rkd.kind_name = 'client_request_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()) LIMIT 1) AS matter_id,
         (SELECT r.target_entity_id FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.source_entity_id = e.id AND rkd.kind_name = 'client_request_from'
              AND (r.valid_to IS NULL OR r.valid_to > now()) LIMIT 1) AS contact_id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'client_request' AND e.status = 'active'
       LIMIT 1`,
      [ctx.tenantId, requestEntityId],
    )
    const r = res.rows[0]
    if (!r) return null
    return {
      requestEntityId: r.request_id,
      requestType: r.request_type ?? '',
      status: r.status ?? 'requested',
      amount: r.amount ?? '0.00',
      currency: r.currency ?? 'USD',
      description: r.description ?? '',
      matterEntityId: r.matter_id,
      clientContactId: r.contact_id,
    }
  })
}
