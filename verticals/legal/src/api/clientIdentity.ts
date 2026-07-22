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

export interface ClientMembership extends ResolvedClientContact {
  firmName: string
  firmSlug: string | null
}

// The reserved control-plane tenants are never client-portal firms: the platform
// tenant holds operator actors, and the sandbox holds demo/cert fixtures whose
// contacts can carry REAL emails (founder walks) — surfacing either in a real
// person's firm list would be wrong. Mirrors lookupActorByEmail (ADR 0046).
const RESERVED_TENANTS = `('00000000-0000-0000-00FF-000000000001',
           '00000000-0000-0000-00FE-000000000001')`

// ALL firms where this email is an ACTIVE client_contact, cross-tenant — the
// person's portal memberships. Ordered oldest-contact-first: the firm the person
// signed up with predates any contact created later (e.g. via a referral), so
// memberships[0] is their MAIN firm and the default portal at sign-in.
//
// One row per tenant: if a tenant somehow holds two active contacts with the
// same email, the OLDEST wins (the original signup record) — deterministic,
// instead of the previous total lockout. Exposes only the two tenant fields
// that are already public via resolve_public_firm (name + public_slug); the
// caller may return the list only to a requester who PROVED control of the
// email (verified Supabase token or an authed portal session).
export async function findClientContactMembershipsByEmail(
  email: string,
): Promise<ClientMembership[]> {
  if (!email) return []
  return withSuperuser(async (client) => {
    const res = await client.query<{
      entity_id: string
      tenant_id: string
      full_name: string | null
      email: string
      firm_name: string
      firm_slug: string | null
    }>(
      `WITH latest_emails AS (
         SELECT DISTINCT ON (a.entity_id)
           a.entity_id, a.tenant_id, a.value, e.created_at
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
       ),
       per_tenant AS (
         SELECT DISTINCT ON (le.tenant_id)
           le.entity_id, le.tenant_id, le.created_at,
           ln.name_value #>> '{}' AS full_name,
           le.value #>> '{}' AS email
         FROM latest_emails le
         LEFT JOIN latest_names ln ON ln.entity_id = le.entity_id
         WHERE lower(le.value #>> '{}') = lower($1)
           AND le.tenant_id NOT IN ${RESERVED_TENANTS}
         ORDER BY le.tenant_id, le.created_at ASC, le.entity_id
       )
       SELECT pt.entity_id, pt.tenant_id, pt.full_name, pt.email,
              t.name AS firm_name, t.public_slug AS firm_slug
       FROM per_tenant pt
       JOIN tenant t ON t.id = pt.tenant_id AND t.status = 'active'
       ORDER BY pt.created_at ASC, pt.tenant_id`,
      [email],
    )
    return res.rows.map((row) => ({
      clientContactId: row.entity_id,
      tenantId: row.tenant_id,
      displayName: row.full_name ?? row.email,
      email: row.email,
      firmName: row.firm_name,
      firmSlug: row.firm_slug,
    }))
  })
}

// Find an ACTIVE client_contact by email, cross-tenant — the single-firm view.
// Returns the contact only when the email maps to EXACTLY one firm; a
// multi-firm person resolves null here (callers that can handle several firms
// use findClientContactMembershipsByEmail instead; single-firm-only callers
// keep the old fail-closed behavior). Returns null when no active
// client_contact has that email — the caller must NOT leak that distinction to
// the requester (anti-enumeration).
export async function findClientContactByEmail(
  email: string,
): Promise<ResolvedClientContact | null> {
  const memberships = await findClientContactMembershipsByEmail(email)
  const only = memberships.length === 1 ? memberships[0] : undefined
  if (!only) return null
  const { clientContactId, tenantId, displayName, email: resolved } = only
  return { clientContactId, tenantId, displayName, email: resolved }
}

// Tenant-scoped variant for callers that already know the firm (e.g. the e-sign
// channel auto-detect, where the SENDER's tenant is the only one that matters).
// A multi-firm person is still "a known client" inside each of their firms.
export async function findClientContactByEmailInTenant(
  tenantId: string,
  email: string,
): Promise<ResolvedClientContact | null> {
  if (!email || !tenantId) return null
  const memberships = await findClientContactMembershipsByEmail(email)
  return memberships.find((m) => m.tenantId === tenantId) ?? null
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

// The contact's portal tier (Users & Roles portal tab): 'standard' loses the AI
// assistant, 'self_serve' has full access. ABSENT means self_serve — the
// pre-existing behavior — so the gate can deploy with zero backfill. Read
// per-request at the enforcement points (assistant stream route, portal home),
// never stamped into the session cookie, so a downgrade applies immediately.
export async function resolvePortalUserType(
  tenantId: string,
  clientContactId: string,
): Promise<'standard' | 'self_serve'> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'portal_user_type'
         AND (a.valid_to IS NULL OR a.valid_to > now())
       ORDER BY a.valid_from DESC LIMIT 1`,
      [tenantId, clientContactId],
    )
    return res.rows[0]?.value === 'standard' ? 'standard' : 'self_serve'
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
