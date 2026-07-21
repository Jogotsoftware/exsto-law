import { withActionContext, type ActionContext } from '@exsto/substrate'

// Reads for the CRM, organized around the COMPANY (migration 0067). A company is
// the account: contacts attach via contact_of_company (contact→company), matters
// via matter_of_company (matter→company); matters also connect to contacts via
// matter_contact (many-to-many). A company with engagement_status = 'client' is a
// client (the Clients tab is a filter over companies). The company's display name
// is entity.name. Bitemporal discipline: current attribute = latest valid_from;
// current relationship = valid_to open; archived entities excluded.

export interface CompanySummary {
  companyEntityId: string
  name: string
  engagementStatus: string
  billableRate: string | null
  billingType: string | null
  mainContactId: string | null
  contactCount: number
  matterCount: number
  createdAt: string
}

export interface CompanyContactRow {
  contactEntityId: string
  fullName: string
  email: string
  phone: string | null
  isMain: boolean
}

export interface CompanyMatterRow {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  status: string
  createdAt: string
}

export interface CompanyDetail extends CompanySummary {
  contacts: CompanyContactRow[]
  matters: CompanyMatterRow[]
}

// List companies (the CRM Companies tab). When onlyClients is true, returns only
// companies with engagement_status = 'client' (the Clients tab).
export async function listCompanies(
  ctx: ActionContext,
  opts?: { onlyClients?: boolean },
): Promise<CompanySummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      company_entity_id: string
      name: string | null
      engagement_status: string | null
      billable_rate: string | null
      billing_type: string | null
      main_contact_id: string | null
      contact_count: string
      matter_count: string
      created_at: Date
    }>(
      `
       SELECT e.id AS company_entity_id, e.name AS name,
         coalesce((SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_engagement_status' ORDER BY a.valid_from DESC LIMIT 1), 'prospect') AS engagement_status,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_billable_rate' ORDER BY a.valid_from DESC LIMIT 1) AS billable_rate,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_billing_type' ORDER BY a.valid_from DESC LIMIT 1)  AS billing_type,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_main_contact' ORDER BY a.valid_from DESC LIMIT 1)  AS main_contact_id,
         (SELECT count(*) FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'contact_of_company'
              AND (r.valid_to IS NULL OR r.valid_to > now()))::text AS contact_count,
         (SELECT count(*) FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'matter_of_company'
              AND (r.valid_to IS NULL OR r.valid_to > now()))::text AS matter_count,
         e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'company' AND e.status = 'active'
       ORDER BY name NULLS LAST`,
      [ctx.tenantId],
    )
    const rows = res.rows.map((r) => ({
      companyEntityId: r.company_entity_id,
      name: r.name ?? '',
      engagementStatus: r.engagement_status ?? 'prospect',
      billableRate: r.billable_rate,
      billingType: r.billing_type,
      mainContactId: r.main_contact_id,
      contactCount: Number(r.contact_count),
      matterCount: Number(r.matter_count),
      createdAt: r.created_at.toISOString(),
    }))
    return opts?.onlyClients ? rows.filter((r) => r.engagementStatus === 'client') : rows
  })
}

export async function getCompany(
  ctx: ActionContext,
  companyEntityId: string,
): Promise<CompanyDetail | null> {
  return withActionContext(ctx, async (client) => {
    const base = await client.query<{
      id: string
      name: string | null
      engagement_status: string | null
      billable_rate: string | null
      billing_type: string | null
      main_contact_id: string | null
      created_at: Date
    }>(
      `
       SELECT e.id, e.name AS name,
         coalesce((SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_engagement_status' ORDER BY a.valid_from DESC LIMIT 1), 'prospect') AS engagement_status,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_billable_rate' ORDER BY a.valid_from DESC LIMIT 1) AS billable_rate,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_billing_type' ORDER BY a.valid_from DESC LIMIT 1)  AS billing_type,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'company_main_contact' ORDER BY a.valid_from DESC LIMIT 1)  AS main_contact_id,
         e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'company' AND e.status = 'active'`,
      [ctx.tenantId, companyEntityId],
    )
    const c = base.rows[0]
    if (!c) return null

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
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'contact_of_company'
         AND (r.valid_to IS NULL OR r.valid_to > now()) AND e.status = 'active'
       ORDER BY full_name NULLS LAST`,
      [ctx.tenantId, companyEntityId],
    )

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
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'matter_status' AND (a.valid_to IS NULL OR a.valid_to > now()) ORDER BY a.valid_from DESC LIMIT 1) AS status,
         e.created_at
       FROM entity e
       JOIN relationship r ON r.source_entity_id = e.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'matter_of_company'
         AND (r.valid_to IS NULL OR r.valid_to > now()) AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, companyEntityId],
    )

    const mainContactId = c.main_contact_id
    return {
      companyEntityId: c.id,
      name: c.name ?? '',
      engagementStatus: c.engagement_status ?? 'prospect',
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
