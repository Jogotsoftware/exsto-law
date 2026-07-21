import { withActionContext, type ActionContext } from '@exsto/substrate'
import { deriveCrmBucket, type CrmBucket } from './contacts.js'

// Reads for the Clients CRM (beta sprint Obj 2/3). Client is the parent
// (migration 0020): contacts attach via contact_of (contact→client), matters via
// matter_of (matter→client). Settings live as attributes on the client. Bitemporal
// discipline (exsto-query-substrate): current attribute state = latest valid_from;
// relationships current via valid_to open; archived entities excluded.
//
// li-wp-j (CRM restyle): the comp's client-list table shows a STATUS chip and a
// LAST ACTIVITY column that didn't exist for clients before (only contacts had
// them). Rather than invent a new field to maintain, reuse the exact same
// derivation contacts already use — deriveCrmBucket over the client's matters'
// statuses — so "Active/Prospective/Prior" reads identically everywhere in the
// CRM. lastActivityAt mirrors contacts.ts: latest matter creation, else the
// client's own createdAt.

export type { CrmBucket }

export interface ClientSummary {
  clientEntityId: string
  name: string
  billableRate: string | null
  billingType: string | null
  /** WP B3: CRM comp parity — the client's own website (client_website attribute,
   *  migration 0172; null when unset or when the attribute kind doesn't exist
   *  yet for this tenant — the same left-join-to-null the client already gets
   *  for any as-yet-unset attribute). */
  website: string | null
  /** PORTAL-1 (WP3): portal-scheduled time is billable for this client. */
  portalSchedulingBillable?: boolean
  mainContactId: string | null
  /** li-wp-j: the main contact's name, for the CRM list's CONTACT column. */
  mainContactName: string | null
  contactCount: number
  matterCount: number
  crmBucket: CrmBucket
  lastActivityAt: string
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
export async function listClients(ctx: ActionContext): Promise<ClientSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      client_entity_id: string
      name: string | null
      billable_rate: string | null
      billing_type: string | null
      website: string | null
      main_contact_id: string | null
      main_contact_name: string | null
      contact_count: string
      matter_count: string
      matter_statuses: string[] | null
      created_at: Date
      last_activity_at: Date
    }>(
      `
       WITH matter_rollup AS (
         SELECT mo.target_entity_id AS client_id,
                array_agg(ms.value #>> '{}') FILTER (WHERE ms.value IS NOT NULL) AS statuses,
                max(me.created_at) AS last_at
         FROM relationship mo
         JOIN relationship_kind_definition mok ON mok.id = mo.relationship_kind_id AND mok.kind_name = 'matter_of'
         JOIN entity me ON me.id = mo.source_entity_id AND me.tenant_id = $1 AND me.status = 'active'
         LEFT JOIN LATERAL (
           SELECT a.value
           FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = $1 AND a.entity_id = mo.source_entity_id AND akd.kind_name = 'matter_status'
           ORDER BY a.valid_from DESC
           LIMIT 1
         ) ms ON true
         WHERE mo.tenant_id = $1 AND (mo.valid_to IS NULL OR mo.valid_to > now())
         GROUP BY mo.target_entity_id
       )
       SELECT e.id AS client_entity_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_name' ORDER BY a.valid_from DESC LIMIT 1)          AS name,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_billable_rate' ORDER BY a.valid_from DESC LIMIT 1) AS billable_rate,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_billing_type' ORDER BY a.valid_from DESC LIMIT 1)  AS billing_type,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_website' ORDER BY a.valid_from DESC LIMIT 1)      AS website,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_main_contact' ORDER BY a.valid_from DESC LIMIT 1)  AS main_contact_id,
         COALESCE(
           (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
             WHERE a.tenant_id = $1 AND akd.kind_name = 'contact_full_name'
               AND a.entity_id = (SELECT a2.value #>> '{}' FROM attribute a2 JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id WHERE a2.tenant_id = $1 AND a2.entity_id = e.id AND akd2.kind_name = 'client_main_contact' ORDER BY a2.valid_from DESC LIMIT 1)::uuid
             ORDER BY a.valid_from DESC LIMIT 1),
           (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
             WHERE a.tenant_id = $1 AND akd.kind_name = 'full_name'
               AND a.entity_id = (SELECT a2.value #>> '{}' FROM attribute a2 JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id WHERE a2.tenant_id = $1 AND a2.entity_id = e.id AND akd2.kind_name = 'client_main_contact' ORDER BY a2.valid_from DESC LIMIT 1)::uuid
             ORDER BY a.valid_from DESC LIMIT 1)
         ) AS main_contact_name,
         (SELECT count(*) FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'contact_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()))::text AS contact_count,
         (SELECT count(*) FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            JOIN entity me ON me.id = r.source_entity_id AND me.tenant_id = $1 AND me.status = 'active'
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'matter_of'
              AND (r.valid_to IS NULL OR r.valid_to > now()))::text AS matter_count,
         mr.statuses AS matter_statuses,
         e.created_at,
         COALESCE(mr.last_at, e.created_at) AS last_activity_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       LEFT JOIN matter_rollup mr ON mr.client_id = e.id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'client' AND e.status = 'active'
       ORDER BY name NULLS LAST`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      clientEntityId: r.client_entity_id,
      name: r.name ?? '',
      billableRate: r.billable_rate,
      billingType: r.billing_type,
      website: r.website,
      mainContactId: r.main_contact_id,
      mainContactName: r.main_contact_name,
      contactCount: Number(r.contact_count),
      matterCount: Number(r.matter_count),
      crmBucket: deriveCrmBucket(r.matter_statuses ?? []),
      lastActivityAt: r.last_activity_at.toISOString(),
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
      website: string | null
      main_contact_id: string | null
      portal_scheduling_billable: string | null
      created_at: Date
    }>(
      `
       SELECT e.id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_name' ORDER BY a.valid_from DESC LIMIT 1)          AS name,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_billable_rate' ORDER BY a.valid_from DESC LIMIT 1) AS billable_rate,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_billing_type' ORDER BY a.valid_from DESC LIMIT 1)  AS billing_type,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_website' ORDER BY a.valid_from DESC LIMIT 1)      AS website,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'client_main_contact' ORDER BY a.valid_from DESC LIMIT 1)  AS main_contact_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'portal_scheduling_billable' ORDER BY a.valid_from DESC LIMIT 1) AS portal_scheduling_billable,
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
      `
       SELECT e.id AS contact_entity_id,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'full_name' ORDER BY a.valid_from DESC LIMIT 1) AS full_name,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'email' ORDER BY a.valid_from DESC LIMIT 1)     AS email,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'phone' ORDER BY a.valid_from DESC LIMIT 1)     AS phone
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
      `
       SELECT e.id AS matter_entity_id, e.name AS matter_number,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'service_key' ORDER BY a.valid_from DESC LIMIT 1)   AS service_key,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'matter_status' ORDER BY a.valid_from DESC LIMIT 1) AS status,
         e.created_at
       FROM entity e
       JOIN relationship r ON r.source_entity_id = e.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'matter_of'
         AND (r.valid_to IS NULL OR r.valid_to > now()) AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, clientEntityId],
    )

    const mainContactRow = contactsRes.rows.find((r) => r.contact_entity_id === mainContactId)
    return {
      clientEntityId: c.id,
      name: c.name ?? '',
      billableRate: c.billable_rate,
      billingType: c.billing_type,
      website: c.website,
      portalSchedulingBillable: c.portal_scheduling_billable === 'true',
      mainContactId,
      mainContactName: mainContactRow?.full_name ?? null,
      contactCount: contactsRes.rows.length,
      matterCount: mattersRes.rows.length,
      crmBucket: deriveCrmBucket(mattersRes.rows.map((r) => r.status ?? 'inquiry')),
      lastActivityAt: (mattersRes.rows[0]?.created_at ?? c.created_at).toISOString(),
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
