import { NextResponse } from 'next/server'
import { findTool } from '@exsto/mcp-tools'
// Register the legal vertical's MCP tools into the shared registry (side effect).
// @exsto/mcp-tools is now vertical-agnostic; the legal surface opts its tools in.
import '@exsto/legal/mcp'
import { withSuperuser } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Demo session: client sends x-actor-id + x-tenant-id headers, server validates
// against the actor table before binding the action context. Forgeable by
// design (no cookie signing); good enough for the demo.
async function resolveCtx(
  request: Request,
): Promise<ActionContext | { error: string; status: number }> {
  const actorId = request.headers.get('x-actor-id')
  const tenantId = request.headers.get('x-tenant-id')
  if (!actorId || !tenantId) {
    return { error: 'Not signed in. Sign in with Google to continue.', status: 401 }
  }
  if (!UUID_RE.test(actorId) || !UUID_RE.test(tenantId)) {
    return { error: 'Invalid session.', status: 401 }
  }
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
