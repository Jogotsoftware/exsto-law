import { withSuperuser } from '@exsto/shared'

// Client-portal identity resolution. The client portal authenticates a
// client_contact (a person record — Marcus, Priya), NOT an actor: all portal
// writes still run as the public-intake SYSTEM actor (ADR 0035). These helpers
// resolve the client_contact and the matters they are client_of.
//
// Runs under withSuperuser for the email lookup (same reason as
// lookupActorByEmail in api/identity.ts): until we resolve the contact we don't
// know which tenant they belong to — that is the question. After resolution
// everything is tenant-scoped.

export interface ResolvedClientContact {
  clientContactId: string
  tenantId: string
  displayName: string
  email: string
}

// Find an ACTIVE client_contact by email, cross-tenant. Mirrors the intake
// handler's findContactByEmail (latest email attribute, case-insensitive), but
// cross-tenant because the portal login form has only the email. Returns null
// when no active client_contact has that email — the caller must NOT leak that
// distinction to the requester (anti-enumeration).
export async function findClientContactByEmail(
  email: string,
): Promise<ResolvedClientContact | null> {
  if (!email) return null
  return withSuperuser(async (client) => {
    const res = await client.query<{
      entity_id: string
      tenant_id: string
      full_name: string | null
      email: string
    }>(
      `WITH latest_emails AS (
         SELECT DISTINCT ON (a.entity_id)
           a.entity_id, a.tenant_id, a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         JOIN entity e ON e.id = a.entity_id
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
         WHERE akd.kind_name = 'email'
           AND ekd.kind_name = 'client_contact'
           AND e.status = 'active'
         ORDER BY a.entity_id, a.valid_from DESC
       ),
       latest_names AS (
         SELECT DISTINCT ON (a.entity_id)
           a.entity_id, a.value AS name_value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         WHERE akd.kind_name = 'full_name'
         ORDER BY a.entity_id, a.valid_from DESC
       )
       SELECT le.entity_id, le.tenant_id,
              ln.name_value #>> '{}' AS full_name,
              le.value #>> '{}' AS email
       FROM latest_emails le
       LEFT JOIN latest_names ln ON ln.entity_id = le.entity_id
       WHERE lower(le.value #>> '{}') = lower($1)
       ORDER BY le.entity_id
       LIMIT 2`,
      [email],
    )
    // Fail CLOSED on cross-tenant ambiguity: if the same email is an active
    // client_contact in more than one tenant we cannot tell which firm's portal
    // the user means, so return null (caller shows a generic "contact the firm")
    // rather than silently first-winning a tenant by entity_id ordering, which
    // could land them in the wrong firm's portal.
    if (res.rows.length > 1) return null
    const row = res.rows[0]
    if (!row) return null
    return {
      clientContactId: row.entity_id,
      tenantId: row.tenant_id,
      displayName: row.full_name ?? row.email,
      email: row.email,
    }
  })
}

// Re-resolve, from the DB, the set of matter ids a client_contact is client_of.
// Called at magic-token consume time so the session's matter set reflects the
// CURRENT state, and re-checked on every authed request via isClientContactActive.
// Tenant-scoped (the contact's tenant is known by now). Only active matters with
// a current (open-ended) client_of relationship are returned.
export async function resolveClientMatterIds(
  tenantId: string,
  clientContactId: string,
): Promise<string[]> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ matter_id: string }>(
      `SELECT DISTINCT r.target_entity_id AS matter_id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity m ON m.id = r.target_entity_id
       JOIN entity_kind_definition mekd ON mekd.id = m.entity_kind_id
       WHERE r.tenant_id = $1
         AND r.source_entity_id = $2
         AND rkd.kind_name = 'client_of'
         AND (r.valid_to IS NULL OR r.valid_to > now())
         AND mekd.kind_name = 'matter'
         AND m.status = 'active'`,
      [tenantId, clientContactId],
    )
    return res.rows.map((row) => row.matter_id)
  })
}

// Re-check that a client_contact is still an ACTIVE entity in its tenant. Called
// on every authed portal request so a deactivated/removed contact can't keep
// acting with an unexpired session cookie (mirrors the attorney route's live
// re-check of the actor table). Tenant-scoped.
export async function isClientContactActive(
  tenantId: string,
  clientContactId: string,
): Promise<boolean> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT e.id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.id = $1 AND e.tenant_id = $2
         AND ekd.kind_name = 'client_contact'
         AND e.status = 'active'
       LIMIT 1`,
      [clientContactId, tenantId],
    )
    return res.rows.length === 1
  })
}

// The client_contact's current email (latest attribute). Tenant-scoped; used to
// build the signing ClientPrincipal in the portal e-sign tools.
export async function loadClientContactEmail(
  tenantId: string,
  clientContactId: string,
): Promise<string | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ email: string }>(
      `SELECT a.value #>> '{}' AS email
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'email'
       ORDER BY a.valid_from DESC LIMIT 1`,
      [tenantId, clientContactId],
    )
    return res.rows[0]?.email ?? null
  })
}
