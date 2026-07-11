import { withActionContext, type ActionContext } from '@exsto/substrate'

export interface ReferralPartnerSummary {
  partnerEntityId: string
  fullName: string
  email: string | null
  phone: string | null
  firm: string | null
  specialty: string | null
  createdAt: string
  updatedAt: string
}

export interface ReferralPartnerDetail extends ReferralPartnerSummary {
  address: string | null
  referralTerms: string | null
  notes: string | null
}

export interface OtherAttorneySummary {
  attorneyEntityId: string
  fullName: string
  email: string | null
  phone: string | null
  firm: string | null
  role: string | null
  createdAt: string
  updatedAt: string
}

export interface OtherAttorneyDetail extends OtherAttorneySummary {
  barNumber: string | null
  barState: string | null
  notes: string | null
}

const PARTNER_ATTRS = [
  'partner_full_name',
  'partner_email',
  'partner_phone',
  'partner_firm',
  'partner_address',
  'partner_specialty',
  'partner_referral_terms',
  'partner_notes',
]

const ATTORNEY_ATTRS = [
  'attorney_full_name',
  'attorney_email',
  'attorney_phone',
  'attorney_firm',
  'attorney_bar_number',
  'attorney_bar_state',
  'attorney_role',
  'attorney_notes',
]

export async function listReferralPartners(ctx: ActionContext): Promise<ReferralPartnerSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      entity_id: string
      full_name: string | null
      email: string | null
      phone: string | null
      firm: string | null
      specialty: string | null
      created_at: Date
      updated_at: Date | null
    }>(
      `SELECT
         e.id AS entity_id,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'partner_full_name'
          ORDER BY a.valid_from DESC LIMIT 1) AS full_name,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'partner_email'
          ORDER BY a.valid_from DESC LIMIT 1) AS email,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'partner_phone'
          ORDER BY a.valid_from DESC LIMIT 1) AS phone,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'partner_firm'
          ORDER BY a.valid_from DESC LIMIT 1) AS firm,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'partner_specialty'
          ORDER BY a.valid_from DESC LIMIT 1) AS specialty,
         e.created_at,
         (SELECT max(a.valid_from) FROM attribute a
          WHERE a.tenant_id = $1 AND a.entity_id = e.id) AS updated_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'referral_partner' AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      partnerEntityId: r.entity_id,
      fullName: r.full_name ?? '',
      email: r.email,
      phone: r.phone,
      firm: r.firm,
      specialty: r.specialty,
      createdAt: r.created_at.toISOString(),
      updatedAt: (r.updated_at ?? r.created_at).toISOString(),
    }))
  })
}

export async function getReferralPartner(
  ctx: ActionContext,
  entityId: string,
): Promise<ReferralPartnerDetail | null> {
  return withActionContext(ctx, async (client) => {
    const base = await client.query<{ id: string; created_at: Date }>(
      `SELECT e.id, e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'referral_partner'`,
      [ctx.tenantId, entityId],
    )
    if (!base.rows[0]) return null
    const attrs = await loadAttrs(client, ctx.tenantId, entityId, PARTNER_ATTRS)
    return {
      partnerEntityId: entityId,
      fullName: attrs.get('partner_full_name') ?? '',
      email: attrs.get('partner_email') ?? null,
      phone: attrs.get('partner_phone') ?? null,
      firm: attrs.get('partner_firm') ?? null,
      address: attrs.get('partner_address') ?? null,
      specialty: attrs.get('partner_specialty') ?? null,
      referralTerms: attrs.get('partner_referral_terms') ?? null,
      notes: attrs.get('partner_notes') ?? null,
      createdAt: base.rows[0].created_at.toISOString(),
      updatedAt: (attrs.latest ?? base.rows[0].created_at).toISOString(),
    }
  })
}

export async function listOtherAttorneys(ctx: ActionContext): Promise<OtherAttorneySummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      entity_id: string
      full_name: string | null
      email: string | null
      phone: string | null
      firm: string | null
      role: string | null
      created_at: Date
      updated_at: Date | null
    }>(
      `SELECT
         e.id AS entity_id,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'attorney_full_name'
          ORDER BY a.valid_from DESC LIMIT 1) AS full_name,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'attorney_email'
          ORDER BY a.valid_from DESC LIMIT 1) AS email,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'attorney_phone'
          ORDER BY a.valid_from DESC LIMIT 1) AS phone,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'attorney_firm'
          ORDER BY a.valid_from DESC LIMIT 1) AS firm,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'attorney_role'
          ORDER BY a.valid_from DESC LIMIT 1) AS role,
         e.created_at,
         (SELECT max(a.valid_from) FROM attribute a
          WHERE a.tenant_id = $1 AND a.entity_id = e.id) AS updated_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'other_attorney' AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      attorneyEntityId: r.entity_id,
      fullName: r.full_name ?? '',
      email: r.email,
      phone: r.phone,
      firm: r.firm,
      role: r.role,
      createdAt: r.created_at.toISOString(),
      updatedAt: (r.updated_at ?? r.created_at).toISOString(),
    }))
  })
}

export async function getOtherAttorney(
  ctx: ActionContext,
  entityId: string,
): Promise<OtherAttorneyDetail | null> {
  return withActionContext(ctx, async (client) => {
    const base = await client.query<{ id: string; created_at: Date }>(
      `SELECT e.id, e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'other_attorney'`,
      [ctx.tenantId, entityId],
    )
    if (!base.rows[0]) return null
    const attrs = await loadAttrs(client, ctx.tenantId, entityId, ATTORNEY_ATTRS)
    return {
      attorneyEntityId: entityId,
      fullName: attrs.get('attorney_full_name') ?? '',
      email: attrs.get('attorney_email') ?? null,
      phone: attrs.get('attorney_phone') ?? null,
      firm: attrs.get('attorney_firm') ?? null,
      barNumber: attrs.get('attorney_bar_number') ?? null,
      barState: attrs.get('attorney_bar_state') ?? null,
      role: attrs.get('attorney_role') ?? null,
      notes: attrs.get('attorney_notes') ?? null,
      createdAt: base.rows[0].created_at.toISOString(),
      updatedAt: (attrs.latest ?? base.rows[0].created_at).toISOString(),
    }
  })
}

interface AttrMap {
  get(name: string): string | undefined
  latest: Date | null
}

async function loadAttrs(
  client: { query: <T>(sql: string, params: unknown[]) => Promise<{ rows: T[] }> },
  tenantId: string,
  entityId: string,
  kinds: string[],
): Promise<AttrMap> {
  const res = await client.query<{ kind_name: string; value: unknown; valid_from: Date }>(
    `SELECT DISTINCT ON (akd.kind_name) akd.kind_name, a.value, a.valid_from
     FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = ANY($3)
     ORDER BY akd.kind_name, a.valid_from DESC`,
    [tenantId, entityId, kinds],
  )
  const map = new Map<string, string>()
  let latest: Date | null = null
  for (const row of res.rows) {
    const v = row.value
    map.set(row.kind_name, typeof v === 'string' ? v : JSON.stringify(v))
    if (!latest || row.valid_from > latest) latest = row.valid_from
  }
  return {
    get: (name) => map.get(name),
    latest,
  }
}
