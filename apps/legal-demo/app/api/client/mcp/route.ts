import { NextResponse } from 'next/server'
import { findTool } from '@exsto/mcp-tools'
// Register the legal vertical's MCP tools into the shared registry (side effect).
// @exsto/mcp-tools is now vertical-agnostic; the legal surface opts its tools in.
import '@exsto/legal/mcp'
import type { ActionContext } from '@exsto/substrate'

export const runtime = 'nodejs'

const TENANT_ID = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
const ACTOR_ID = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0000-000000000004'

// Client portal writes always come from the public-intake system actor; client
// identity (Marcus, Priya) is captured in the client_contact entity and is
// not the action's actor. See ADR 0035.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.toolName) {
    return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
  }
  const tool = findTool(body.toolName)
  if (!tool) {
    return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
  }

  const ctx: ActionContext = { tenantId: TENANT_ID, actorId: ACTOR_ID }
  try {
    const result = await tool.handler(ctx, body.input ?? {})
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
