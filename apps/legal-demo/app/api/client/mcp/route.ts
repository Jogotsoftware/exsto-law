import { NextResponse } from 'next/server'
import { findTool } from '@exsto/mcp-tools'
// Register the legal vertical's MCP tools into the shared registry (side effect),
// and import the vertical's allowlist of which tools the PUBLIC portal may call.
import '@exsto/legal/mcp'
import { isClientPortalTool } from '@exsto/legal/mcp'
import type { ActionContext } from '@exsto/substrate'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { verifyCaptchaIfConfigured } from '@/lib/captcha'
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'

export const runtime = 'nodejs'

// MULTI-TENANT-1: tenant + public-intake actor are resolved PER REQUEST from the
// firm the funnel is on (middleware → x-firm-slug → resolvePublicTenant), not a
// module-level hardcoded const. See lib/publicTenant.ts.

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

  let ctx: ActionContext
  try {
    const pub = await resolvePublicTenant(request)
    ctx = { tenantId: pub.tenantId, actorId: pub.actorId }
  } catch (e) {
    // A named firm that doesn't resolve fails closed — never a dev-tenant write.
    if (e instanceof FirmNotFoundError) {
      return NextResponse.json({ error: 'This firm could not be found.' }, { status: 404 })
    }
    throw e
  }
  // Strip reserved identity keys — on this UNAUTHENTICATED route the body must
  // never be able to impersonate a signed-in client or a verified attorney
  // (the authed routes stamp these from their sessions).
  const input: Record<string, unknown> = { ...(body.input ?? {}) }
  delete input.clientContactId
  delete input.clientIp
  delete input.__attorneySession
  try {
    const result = await tool.handler(ctx, input)
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
