import { NextResponse } from 'next/server'
import { findTool } from '@exsto/mcp-tools'
// Register the legal vertical's MCP tools into the shared registry (side effect).
// @exsto/mcp-tools is now vertical-agnostic; the legal surface opts its tools in.
import '@exsto/legal/mcp'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'
// RUNTIME-AUTORUN-2: an attorney advance/approve here may land a matter on a producing
// stage (generate_document), whose autorun drafts the document synchronously in this
// request (post-commit, never on the advance txn, but still in-request). Allow the model
// budget so it does not time out — matches /workflow/invoke and the assistant route.
export const maxDuration = 300

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.toolName) {
    return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
  }
  const tool = findTool(body.toolName)
  if (!tool) {
    return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
  }

  const ctxOrError = await resolveAttorneyCtx(request)
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
