import { NextResponse } from 'next/server'
import { findTool } from '@exsto/mcp-tools'
// Register the legal vertical's MCP tools into the shared registry (side effect),
// and import the vertical's allowlist of which tools the PUBLIC portal may call.
import '@exsto/legal/mcp'
import { isClientPortalTool } from '@exsto/legal/mcp'
import type { ActionContext } from '@exsto/substrate'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { verifyCaptchaIfConfigured } from '@/lib/captcha'

export const runtime = 'nodejs'

const TENANT_ID = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
// The public-intake system actor seeded by 0001_pacheco_law_vertical_seed.sql.
// MUST match a real actor row — the prior default (…0000-000000000004) was never
// seeded, so every booking action.insert FK-failed (action_actor_id_fkey) and the
// whole booking rolled back. The other client routes already use …0001-…0005.
const ACTOR_ID = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

// Client portal writes always come from the public-intake system actor; client
// identity (Marcus, Priya) is captured in the client_contact entity and is
// not the action's actor. See ADR 0035.
export async function POST(request: Request) {
  // Unauthenticated public route → per-IP rate limit so booking/intake can't be
  // spammed into unbounded matter creation, notification email, and calendar
  // invites (DoS / DB bloat / cost). Best-effort in-memory; see lib/rateLimit.
  const rl = checkPublicRateLimit(clientIpFrom(request))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body?.toolName) {
    return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
  }
  // Default-deny: this route is unauthenticated and runs as the firm's public
  // intake actor, so it may only invoke tools the vertical marks client-safe.
  // A non-allowlisted name gets the SAME 404 as an unknown tool — no oracle for
  // which attorney-only tools exist.
  const tool = isClientPortalTool(body.toolName) ? findTool(body.toolName) : undefined
  if (!tool) {
    return NextResponse.json({ error: `Unknown tool: ${body.toolName}` }, { status: 404 })
  }

  // CAPTCHA gate on the public WRITE (booking/intake) when configured. No-op
  // until TURNSTILE_SECRET/HCAPTCHA_SECRET is set; then it requires a verified
  // body.captchaToken. Reads (service list, availability, draft view) are exempt.
  if (tool.mode === 'write') {
    const captcha = await verifyCaptchaIfConfigured(body.captchaToken, clientIpFrom(request))
    if (!captcha.ok) {
      return NextResponse.json({ error: captcha.reason ?? 'Captcha required.' }, { status: 403 })
    }
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
