import { withSuperuser } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { readSessionFromCookieHeader } from '@/lib/session'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Resolve "who is acting" for an attorney-workspace request, shared by every
// attorney route handler (the MCP dispatch route and the assistant streaming
// route) so authentication is identical everywhere.
//
// Authority is the SIGNED, httpOnly `exsto_session` cookie, verified
// server-side. The old x-actor-id / x-tenant-id headers are NOT trusted in
// production: they were client-set and forgeable. In production, no valid
// cookie ⇒ 401, full stop.
//
// Local-dev exception (NODE_ENV !== 'production' only): we still accept the
// x-actor-id / x-tenant-id headers so the `?demo_user=` flow and ad-hoc curl
// testing keep working without standing up Google OAuth. This fallback never
// runs in production.
export async function resolveAttorneyCtx(
  request: Request,
): Promise<ActionContext | { error: string; status: number }> {
  const isProd = process.env.NODE_ENV === 'production'

  // 1) Trusted path: the verified session cookie.
  const fromCookie = readSessionFromCookieHeader(request.headers.get('cookie'))
  let actorId = fromCookie?.actorId ?? null
  let tenantId = fromCookie?.tenantId ?? null

  // 2) Dev-only fallback: forgeable headers (demo_user / local testing).
  if ((!actorId || !tenantId) && !isProd) {
    actorId = request.headers.get('x-actor-id')
    tenantId = request.headers.get('x-tenant-id')
  }

  if (!actorId || !tenantId) {
    return { error: 'Not signed in. Sign in with Google to continue.', status: 401 }
  }
  if (!UUID_RE.test(actorId) || !UUID_RE.test(tenantId)) {
    return { error: 'Invalid session.', status: 401 }
  }
  // Even a validly-signed cookie is re-checked against the live actor table so a
  // deactivated/removed actor can't keep acting with an unexpired token.
  const ok = await withSuperuser(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM actor
       WHERE id = $1 AND tenant_id = $2
         AND actor_type = 'human' AND status = 'active'
       LIMIT 1`,
      [actorId, tenantId],
    )
    return res.rows.length === 1
  })
  if (!ok) return { error: 'Session no longer valid.', status: 401 }
  return { tenantId, actorId }
}
