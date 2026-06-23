import { NextResponse } from 'next/server'
import { resolveAdminCtx } from '@/lib/adminAuthSession'
import { readAdminSessionFromCookieHeader } from '@/lib/adminSession'

export const runtime = 'nodejs'

// The admin session cookie is httpOnly; the client asks here whether it's signed
// in and for the display-only fields (never the token). This mirrors
// resolveAdminCtx (live is_platform_admin re-check) so "signed in" and "still
// authorized" agree — a revoked admin with an unexpired cookie is bounced by the
// gate, not left staring at a dead console shell.
export async function GET(request: Request) {
  const ctxOrError = await resolveAdminCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }
  // Authorization is re-checked live above; the display fields come from the
  // verified cookie (present, since resolveAdminCtx already validated it).
  const session = readAdminSessionFromCookieHeader(request.headers.get('cookie'))
  return NextResponse.json({
    email: session?.email ?? '',
    displayName: session?.displayName ?? '',
    actorId: ctxOrError.actorId,
    tenantId: ctxOrError.tenantId,
  })
}
