import type { ActionContext } from '@exsto/substrate'
import { isPlatformAdmin } from '@exsto/legal'
import { readAdminSessionFromCookieHeader } from '@/lib/adminSession'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Resolve "who is acting" for an admin-console request, shared by every /admin
// route handler so authentication is identical everywhere (ADR 0046).
//
// Authority is the SIGNED, httpOnly `exsto_admin_session` cookie, verified
// server-side, AND a LIVE re-check that the actor is still an active platform
// admin (is_platform_admin) — so a revoked admin with an unexpired token is
// rejected, mirroring resolveAttorneyCtx's live actor re-check. There is NO
// dev-header fallback: the admin boundary is always cookie-only.
export async function resolveAdminCtx(
  request: Request,
): Promise<ActionContext | { error: string; status: number }> {
  const session = readAdminSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) {
    return { error: 'Not signed in to the admin console.', status: 401 }
  }
  if (!UUID_RE.test(session.actorId) || !UUID_RE.test(session.tenantId)) {
    return { error: 'Invalid admin session.', status: 401 }
  }
  // Even a validly-signed cookie is re-checked against the live platform_admin
  // table so a revoked admin cannot keep acting with an unexpired token.
  if (!(await isPlatformAdmin(session.actorId))) {
    return { error: 'Admin access revoked or no longer valid.', status: 401 }
  }
  return { tenantId: session.tenantId, actorId: session.actorId }
}
