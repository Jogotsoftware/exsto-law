import { NextResponse } from 'next/server'
import {
  isClientContactActive,
  resolveClientMatterIds,
  resolvePortalActorId,
  provisionClientPortalActor,
} from '@exsto/legal'
import { withSuperuser } from '@exsto/shared'
import { signClientSession, buildClientSessionCookie } from '@/lib/clientSession'

// Shared "turn a resolved client_contact into a portal session" path. BOTH the
// magic-link consume route and the Supabase-Auth bridge funnel through here, so
// the security-critical steps happen in exactly one place:
//   • re-check the contact is still active (a deactivated client can't sign in),
//   • RE-RESOLVE the current matterIds from the DB (never trusted from a caller),
//   • load display fields, mint the signed httpOnly cookie.
// The caller has already PROVEN control of the identity (a valid magic token, or
// a verified Supabase session); this function does the substrate-side binding.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The firm's public-intake SYSTEM actor — the submitter of the lazy actor
// backfill above (same default as the client MCP routes).
const PUBLIC_INTAKE_ACTOR_ID =
  process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

// Fetch the contact's current display name + email for the session's display
// fields. Tenant-scoped via withSuperuser (the tenant is already known).
async function loadContactDisplay(
  tenantId: string,
  clientContactId: string,
): Promise<{ email: string; displayName: string } | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ kind_name: string; value: string }>(
      `SELECT akd.kind_name, a.value #>> '{}' AS value
       FROM (
         SELECT DISTINCT ON (a.attribute_kind_id) a.attribute_kind_id, a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         WHERE a.tenant_id = $1 AND a.entity_id = $2
           AND akd.kind_name IN ('email', 'full_name')
         ORDER BY a.attribute_kind_id, a.valid_from DESC
       ) a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id`,
      [tenantId, clientContactId],
    )
    let email: string | null = null
    let displayName: string | null = null
    for (const row of res.rows) {
      if (row.kind_name === 'email') email = row.value
      if (row.kind_name === 'full_name') displayName = row.value
    }
    if (!email) return null
    return { email, displayName: displayName ?? email }
  })
}

export interface MintResult {
  ok: boolean
  /** Set-Cookie header value (only when ok). */
  cookie?: string
  /** Display fields (only when ok). */
  email?: string
  displayName?: string
  /** Failure reason (only when !ok). */
  error?: string
}

// Validate + bind a (tenantId, clientContactId) into a fresh portal session.
// Returns the Set-Cookie value to apply, or a failure reason. Never throws on
// the expected "not active / not found" paths — those return ok:false.
export async function mintClientSession(
  tenantId: string,
  clientContactId: string,
): Promise<MintResult> {
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(clientContactId)) {
    return { ok: false, error: 'Invalid account reference.' }
  }
  const active = await isClientContactActive(tenantId, clientContactId)
  if (!active) {
    return { ok: false, error: 'This account is no longer active. Contact the firm.' }
  }
  const display = await loadContactDisplay(tenantId, clientContactId)
  if (!display) return { ok: false, error: 'This account could not be loaded.' }

  const matterIds = await resolveClientMatterIds(tenantId, clientContactId)

  // PORTAL-1: the session carries the client's OWN actor. Accounts provisioned
  // before this change (or via paths that pre-date it) get the actor lazily on
  // their next sign-in — the provision action is idempotent. The SUBMITTING
  // actor for the backfill is the public-intake system actor; the resulting
  // actor is what the session acts as.
  let clientActorId = await resolvePortalActorId(tenantId, clientContactId)
  if (!clientActorId) {
    const provisioned = await provisionClientPortalActor(
      { tenantId, actorId: PUBLIC_INTAKE_ACTOR_ID },
      { clientContactId, matterEntityIds: matterIds, trigger: 'login_backfill' },
    )
    clientActorId = provisioned.actorId
  }

  const sessionToken = signClientSession({
    clientContactId,
    tenantId,
    clientActorId,
    matterIds,
    email: display.email,
    displayName: display.displayName,
  })
  return {
    ok: true,
    cookie: buildClientSessionCookie(sessionToken),
    email: display.email,
    displayName: display.displayName,
  }
}

// Convenience: build a JSON NextResponse that sets the session cookie (or a 401
// with the failure reason). `redirectInfo` is echoed back to the fetch caller.
export async function mintClientSessionResponse(
  tenantId: string,
  clientContactId: string,
  redirectInfo: { redirect: string; path: string },
): Promise<NextResponse> {
  const result = await mintClientSession(tenantId, clientContactId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true, ...redirectInfo })
  res.headers.set('Set-Cookie', result.cookie as string)
  return res
}
