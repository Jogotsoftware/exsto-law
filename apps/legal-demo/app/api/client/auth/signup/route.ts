// N1 — self-service portal signup (the "Create an account" toggle on
// /portal/login, independent of the intake-gate flow in
// api/client/intake/finalize). Moved server-side for the same reason finalize
// was: admin.generateLink mints the unconfirmed account + token WITHOUT
// Supabase sending its own default email, so we can send our own
// firm-branded one instead. The browser previously called supabase.auth.
// signUp() directly, which always triggered GoTrue's own email — the exact
// thing N1 removes everywhere else.
import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'
import { validatePassword } from '@/lib/passwordPolicy'
import { issuePortalConfirmationEmail } from '@/lib/portalConfirmationEmail'
import type { ConfirmationEmailLang } from '@/lib/confirmationEmailTemplate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exsto-law.netlify.app'
).replace(/\/$/, '')

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`client-auth-signup:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown
    password?: unknown
    lang?: unknown
  } | null
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }
  const pwErr = validatePassword(password)
  if (pwErr) {
    return NextResponse.json({ error: pwErr }, { status: 400 })
  }
  const lang: ConfirmationEmailLang = body?.lang === 'es' ? 'es' : 'en'

  try {
    const pub = await resolvePublicTenant(request)
    const account = await issuePortalConfirmationEmail(
      { tenantId: pub.tenantId, actorId: pub.actorId },
      { email, password, baseUrl: BASE_URL, lang },
    )
    // 'exists' means an already-CONFIRMED account — don't claim we sent
    // anything; the client should sign in instead.
    if (account.status === 'exists') {
      return NextResponse.json({ ok: true, accountExisted: true })
    }
    return NextResponse.json({ ok: true, accountCreated: true })
  } catch (e) {
    if (e instanceof FirmNotFoundError) {
      return NextResponse.json({ error: 'This firm could not be found.' }, { status: 404 })
    }
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
