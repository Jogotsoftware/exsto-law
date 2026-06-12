import { NextResponse } from 'next/server'
import { findTool } from '@exsto/mcp-tools'
// Register the legal vertical's MCP tools into the shared registry (side effect).
// @exsto/mcp-tools is now vertical-agnostic; the legal surface opts its tools in.
import '@exsto/legal/mcp'
import { withSuperuser } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { readSessionFromCookieHeader } from '@/lib/session'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Authority for "who is acting" is the SIGNED, httpOnly `exsto_session` cookie,
// verified server-side. The old x-actor-id / x-tenant-id headers are NO LONGER
// trusted: they were client-set and forgeable, so anyone could act as any actor
// simply by setting them. In production, no valid cookie ⇒ 401, full stop.
//
// Local-dev exception (NODE_ENV !== 'production' only): we still accept the
// x-actor-id / x-tenant-id headers so the `?demo_user=` flow and ad-hoc curl
// testing keep working without standing up Google OAuth. This fallback never
// runs in production.
async function resolveCtx(
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.toolName) {
    return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
  }
  const tool = findTool(body.toolName)
  if (!tool) {
    return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
  }

  const ctxOrError = await resolveCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    const result = await tool.handler(ctxOrError, body.input ?? {})
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
