import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { isClientContactActive, resolveClientMatterIds } from '@exsto/legal'
import { withSuperuser } from '@exsto/shared'
import { safeInternalPath } from '@/lib/safeRedirect'
import {
  verifyClientMagicToken,
  signClientSession,
  buildClientSessionCookie,
} from '@/lib/clientSession'

export const runtime = 'nodejs'

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Fetch the contact's current display name + email (for the session's display
// fields). Tenant-scoped via withSuperuser (we already know the tenant).
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

// POST { token, continue? } — consume a magic-link token and start a session.
//
//   • verify the magic token's MAC + expiry (domain-separated: an attorney or
//     client-session token fails here),
//   • re-check the client_contact is still active,
//   • RE-RESOLVE the client's current matterIds from the DB (never trusted from
//     the token — the token carries only the contact id),
//   • mint the signed, httpOnly client session cookie,
//   • redirect to a validated internal path (default /portal).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    continue?: unknown
  } | null
  const token = typeof body?.token === 'string' ? body.token : null
  const continueParam = typeof body?.continue === 'string' ? body.continue : null
  const dest = safeInternalPath(continueParam, '/portal')

  const magic = verifyClientMagicToken(token)
  if (!magic) {
    return NextResponse.json(
      { error: 'This sign-in link is invalid or has expired. Request a new one.' },
      { status: 401 },
    )
  }
  if (!UUID_RE.test(magic.clientContactId) || !UUID_RE.test(magic.tenantId)) {
    return NextResponse.json({ error: 'Invalid sign-in link.' }, { status: 401 })
  }

  const active = await isClientContactActive(magic.tenantId, magic.clientContactId)
  if (!active) {
    return NextResponse.json(
      { error: 'This account is no longer active. Contact the firm.' },
      { status: 401 },
    )
  }

  const display = await loadContactDisplay(magic.tenantId, magic.clientContactId)
  if (!display) {
    return NextResponse.json({ error: 'Invalid sign-in link.' }, { status: 401 })
  }

  const matterIds = await resolveClientMatterIds(magic.tenantId, magic.clientContactId)

  const sessionToken = signClientSession({
    clientContactId: magic.clientContactId,
    tenantId: magic.tenantId,
    matterIds,
    email: display.email,
    displayName: display.displayName,
  })

  // Return JSON (the login page is a fetch caller) carrying the validated
  // redirect; the cookie is set server-side and httpOnly. The destination is
  // an internal path the client navigates to next.
  const res = NextResponse.json({ ok: true, redirect: `${BASE_URL}${dest}`, path: dest })
  res.headers.set('Set-Cookie', buildClientSessionCookie(sessionToken))
  return res
}
