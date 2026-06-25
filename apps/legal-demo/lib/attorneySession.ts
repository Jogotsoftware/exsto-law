import { withSuperuser } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { readSessionFromCookieHeader } from '@/lib/session'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Re-checking the live actor table on EVERY request adds a DB round-trip (a pooled
// superuser connection + a SELECT) to every MCP/stream call — and a single page fires
// many. The signed cookie already proves identity cryptographically; this query is
// only a backstop to lock out an actor deactivated mid-session. Cache a POSITIVE
// result briefly so a page's burst of calls pays it once, while a deactivation still
// takes effect within the TTL. Negatives are never cached (a reactivated actor is not
// locked out, and a missing actor is cheap to re-check). Keyed per actor+tenant; the
// map holds one entry per active attorney, so it stays tiny.
const ACTOR_VERIFY_TTL_MS = 30_000
const actorVerifiedUntil = new Map<string, number>()

async function actorIsActive(actorId: string, tenantId: string): Promise<boolean> {
  const key = `${actorId}:${tenantId}`
  const cachedUntil = actorVerifiedUntil.get(key)
  if (cachedUntil !== undefined && cachedUntil > Date.now()) return true
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
  if (ok) actorVerifiedUntil.set(key, Date.now() + ACTOR_VERIFY_TTL_MS)
  else actorVerifiedUntil.delete(key)
  return ok
}

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
  // deactivated/removed actor can't keep acting with an unexpired token (cached for
  // a short TTL so a page's many calls don't each pay a DB round-trip).
  const ok = await actorIsActive(actorId, tenantId)
  if (!ok) return { error: 'Session no longer valid.', status: 401 }
  return { tenantId, actorId }
}
