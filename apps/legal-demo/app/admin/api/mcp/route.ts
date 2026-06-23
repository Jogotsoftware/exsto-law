import { NextResponse } from 'next/server'
import { findTool } from '@exsto/mcp-tools'
// Register the legal vertical's MCP tools (side effect) — includes the admin tools.
import '@exsto/legal/mcp'
import { isAdminConsoleTool } from '@exsto/legal/mcp'
import { resolveAdminCtx } from '@/lib/adminAuthSession'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'

export const runtime = 'nodejs'

// Admin-console MCP dispatch (ADR 0046). A SEPARATE boundary from the attorney
// route: it resolves the admin session (resolveAdminCtx) and DEFAULT-DENIES against
// the ADMIN_CONSOLE_TOOLS allowlist — so the attorney/client routes can never reach
// the cross-tenant admin tools, and this route can never reach attorney/client
// tools. Rate-limited like the other write surfaces.
export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`admin:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body?.toolName) {
    return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
  }

  // Authenticate FIRST (true default-deny) so an unauthenticated caller can't use a
  // 401-vs-404 status difference to enumerate which control-plane tools exist.
  const ctxOrError = await resolveAdminCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  // Default-deny: only control-plane tools are reachable here. Return 404 (same as
  // unknown) so the surface doesn't reveal which tools exist.
  if (!isAdminConsoleTool(body.toolName)) {
    return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
  }
  const tool = findTool(body.toolName)
  if (!tool) {
    return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
  }

  try {
    const result = await tool.handler(ctxOrError, body.input ?? {})
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
