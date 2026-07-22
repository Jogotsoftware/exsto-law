import { withActionContext, type ActionContext } from '@exsto/substrate'
import { requireAdmin } from '../api/users.js'
import { DEFAULT_PORTAL_USER_TYPE, type PortalUserType } from '../api/portalAccess.js'

// Users & Roles — the Portal users tab. A "portal user" is an ACTIVE
// client_contact holding a portal_actor_id mapping (the attribute is written at
// provisioning, i.e. first set-password/sign-in — an invited-but-never-signed-in
// contact is not yet a portal user; they appear once they finish the invite).
// Firm staff live in listUsers (api/users.ts); the two lists never overlap
// (listUsers excludes 'client:%' actors).

export interface PortalUserRow {
  contactEntityId: string
  fullName: string
  email: string
  companyName: string | null
  userType: PortalUserType
  /** Mapped portal actor status: 'active', or 'inactive' after a login delete. */
  portalStatus: string
  provisionedAt: string
}

export async function listPortalUsers(ctx: ActionContext): Promise<PortalUserRow[]> {
  // Same gate as listUsers — this is a user-management read.
  await requireAdmin(ctx)
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      contact_entity_id: string
      full_name: string | null
      email: string | null
      company_name: string | null
      user_type: string | null
      portal_status: string | null
      provisioned_at: Date
    }>(
      `SELECT
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
         (SELECT
            (SELECT a2.value #>> '{}' FROM attribute a2
              JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id
             WHERE a2.tenant_id = $1 AND a2.entity_id = r.target_entity_id
               AND akd2.kind_name = 'client_name'
             ORDER BY a2.valid_from DESC LIMIT 1)
          FROM relationship r
          JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
          WHERE r.tenant_id = $1 AND r.source_entity_id = e.id
            AND rkd.kind_name = 'contact_of'
            AND (r.valid_to IS NULL OR r.valid_to > now())
          LIMIT 1
         ) AS company_name,
         (SELECT a.value #>> '{}' FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'portal_user_type'
            AND (a.valid_to IS NULL OR a.valid_to > now())
          ORDER BY a.valid_from DESC LIMIT 1) AS user_type,
         act.status AS portal_status,
         pa.valid_from AS provisioned_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       JOIN LATERAL (
         SELECT a.value #>> '{}' AS actor_id, a.valid_from
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'portal_actor_id'
           AND (a.valid_to IS NULL OR a.valid_to > now())
         ORDER BY a.valid_from DESC LIMIT 1
       ) pa ON true
       LEFT JOIN actor act ON act.id = pa.actor_id::uuid AND act.tenant_id = $1
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'client_contact' AND e.status = 'active'
       ORDER BY full_name NULLS LAST, e.created_at`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      contactEntityId: r.contact_entity_id,
      fullName: r.full_name ?? r.email ?? 'Portal client',
      email: r.email ?? '',
      companyName: r.company_name,
      userType: r.user_type === 'standard' ? 'standard' : DEFAULT_PORTAL_USER_TYPE,
      portalStatus: r.portal_status ?? 'active',
      provisionedAt: r.provisioned_at?.toISOString?.() ?? String(r.provisioned_at),
    }))
  })
}
