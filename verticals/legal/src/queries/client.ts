import { withActionContext, type ActionContext } from '@exsto/substrate'

// Reads for the Clients CRM (beta sprint Obj 2/3). Client is the parent
// (migration 0020): contacts attach via contact_of (contact→client), matters via
// matter_of (matter→client). Settings live as attributes on the client. Bitemporal
// discipline (exsto-query-substrate): current attribute state = latest valid_from;
// relationships current via valid_to open; archived entities excluded.

export interface ClientSummary {
  clientEntityId: string
  name: string
  billableRate: string | null
  billingType: string | null
  mainContactId: string | null
  contactCount: number
  matterCount: number
  createdAt: string
}

export interface ClientContactRow {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  isMain: boolean
}

export interface ClientMatterRow {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  status: string
  createdAt: string
}

export interface ClientDetail extends ClientSummary {
  contacts: ClientContactRow[]
  matters: ClientMatterRow[]
}

// Latest value of a set of attribute kinds for one tenant, keyed (entity, kind).
const ATTRS_CTE = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name)
      a.entity_id, akd.kind_name, a.value
    FROM attribute a
    JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1
    ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )`

export async function listClients(ctx: ActionContext): Promise<ClientSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      client_entity_id: string
      name: string | null
      billable_rate: string | null
      billing_type: string | null
      main_contact_id: string | null
      contact_count: string
      matter_count: string
      created_at: Date
    }>(
      `${ATTRS_CTE}
       SELECT e.id AS client_entity_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_name')          AS name,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_billable_rate') AS billable_rate,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_billing_type')  AS billing_type,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_main_contact')  AS main_contact_id,
         (SELECT count(*) FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'contact_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()))::text AS contact_count,
         (SELECT count(*) FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'matter_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()))::text AS matter_count,
         e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'client' AND e.status = 'active'
       ORDER BY name NULLS LAST`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      clientEntityId: r.client_entity_id,
      name: r.name ?? '',
      billableRate: r.billable_rate,
      billingType: r.billing_type,
      mainContactId: r.main_contact_id,
      contactCount: Number(r.contact_count),
      matterCount: Number(r.matter_count),
      createdAt: r.created_at.toISOString(),
    }))
  })
}

export async function getClient(
  ctx: ActionContext,
  clientEntityId: string,
): Promise<ClientDetail | null> {
  return withActionContext(ctx, async (client) => {
    const base = await client.query<{
      id: string
      name: string | null
      billable_rate: string | null
      billing_type: string | null
      main_contact_id: string | null
      created_at: Date
    }>(
      `${ATTRS_CTE}
       SELECT e.id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_name')          AS name,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_billable_rate') AS billable_rate,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_billing_type')  AS billing_type,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_main_contact')  AS main_contact_id,
         e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'client' AND e.status = 'active'`,
      [ctx.tenantId, clientEntityId],
    )
    const c = base.rows[0]
    if (!c) return null
    const mainContactId = c.main_contact_id

    // Contacts attached to this client (contact_of: contact → client).
    const contactsRes = await client.query<{
      contact_entity_id: string
      full_name: string | null
      email: string | null
      phone: string | null
    }>(
      `${ATTRS_CTE}
       SELECT e.id AS contact_entity_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'full_name') AS full_name,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'email')     AS email,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'phone')     AS phone
       FROM entity e
       JOIN relationship r ON r.source_entity_id = e.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'contact_of'
         AND (r.valid_to IS NULL OR r.valid_to > now()) AND e.status = 'active'
       ORDER BY full_name NULLS LAST`,
      [ctx.tenantId, clientEntityId],
    )

    // Matters attached to this client (matter_of: matter → client).
    const mattersRes = await client.query<{
      matter_entity_id: string
      matter_number: string
      service_key: string | null
      status: string | null
      created_at: Date
    }>(
      `${ATTRS_CTE}
       SELECT e.id AS matter_entity_id, e.name AS matter_number,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'service_key')   AS service_key,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'matter_status') AS status,
         e.created_at
       FROM entity e
       JOIN relationship r ON r.source_entity_id = e.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'matter_of'
         AND (r.valid_to IS NULL OR r.valid_to > now()) AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, clientEntityId],
    )

    return {
      clientEntityId: c.id,
      name: c.name ?? '',
      billableRate: c.billable_rate,
      billingType: c.billing_type,
      mainContactId,
      contactCount: contactsRes.rows.length,
      matterCount: mattersRes.rows.length,
      createdAt: c.created_at.toISOString(),
      contacts: contactsRes.rows.map((r) => ({
        contactEntityId: r.contact_entity_id,
        fullName: r.full_name ?? '',
        email: r.email ?? '',
        phone: r.phone,
        isMain: r.contact_entity_id === mainContactId,
      })),
      matters: mattersRes.rows.map((r) => ({
        matterEntityId: r.matter_entity_id,
        matterNumber: r.matter_number,
        serviceKey: r.service_key ?? '',
        status: r.status ?? 'intake_submitted',
        createdAt: r.created_at.toISOString(),
      })),
    }
  })
}
