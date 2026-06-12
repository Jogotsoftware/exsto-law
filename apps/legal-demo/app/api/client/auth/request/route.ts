import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { findClientContactByEmail, queueNotification } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import { signClientMagicToken } from '@/lib/clientSession'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { verifyCaptchaIfConfigured } from '@/lib/captcha'

export const runtime = 'nodejs'

// Same hardcoded base as the OAuth callback / logout: Netlify Functions hand
// Next.js a request.url with the internal port baked in, which breaks links.
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

// The public-intake SYSTEM actor in the firm's tenant — used only to enqueue the
// notification (the queue is tenant-scoped). Client identity lives on the
// resolved client_contact, not this actor (ADR 0035).
const ACTOR_ID = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

// The single neutral response, built fresh each call. It MUST be a new Response
// per invocation — a Response body can be read only once, so a shared module-level
// constant would throw "Body is unusable" on the second request. The message is
// byte-identical regardless of whether the email matched (anti-enumeration).
function neutral(): NextResponse {
  return NextResponse.json({
    message: "If that email is on file, we've sent a sign-in link.",
  })
}

// POST { email, captchaToken } — request a magic sign-in link.
//
// ANTI-ENUMERATION (security-critical): this endpoint ALWAYS returns the same
// 200 "if that email is on file…" response whether or not a client_contact
// matched. It never reveals which emails are clients of the firm. Only when a
// match is found do we actually mint a token and queue the email — and that side
// effect is invisible to the requester.
//
// Abuse controls: a tight per-IP rate-limit bucket (this is an email-sending
// endpoint) + CAPTCHA when configured.
export async function POST(request: Request) {
  // Tight bucket: this triggers outbound email, so it's more sensitive than the
  // generic public route. Re-keyed so it doesn't share the booking budget.
  const rl = checkPublicRateLimit(`client-auth-request:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown
    captchaToken?: unknown
  } | null
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const captchaToken = typeof body?.captchaToken === 'string' ? body.captchaToken : undefined

  // CAPTCHA gate (no-op until a provider secret is configured).
  const captcha = await verifyCaptchaIfConfigured(captchaToken, clientIpFrom(request))
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.reason ?? 'Captcha required.' }, { status: 403 })
  }

  // A malformed/empty email is indistinguishable from an unknown one: neutral 200.
  if (!email || !email.includes('@')) {
    return neutral()
  }

  // Resolve cross-tenant. On NO match we queue nothing and return the SAME
  // response — no leak, no side effect.
  let contact: Awaited<ReturnType<typeof findClientContactByEmail>> = null
  try {
    contact = await findClientContactByEmail(email)
  } catch {
    // Even an internal failure must not change the externally observable
    // response (no oracle). Swallow and return neutral.
    return neutral()
  }
  if (!contact) {
    return neutral()
  }

  // Match: mint a short-lived magic token and queue the link to the ON-FILE
  // email (never to an address the requester could substitute — we use the
  // contact's resolved email).
  try {
    const token = signClientMagicToken({
      clientContactId: contact.clientContactId,
      tenantId: contact.tenantId,
    })
    const loginUrl = `${BASE_URL}/portal/login?token=${encodeURIComponent(token)}`
    const ctx: ActionContext = { tenantId: contact.tenantId, actorId: ACTOR_ID }
    await queueNotification(ctx, {
      routeKindName: 'client_portal_magic_link',
      to: contact.email,
      variables: {
        client_full_name: contact.displayName,
        login_url: loginUrl,
      },
    })
  } catch {
    // Queueing failed; still return the neutral response so the outcome is not
    // observable. (Operationally this would be logged server-side.)
  }

  return neutral()
}
