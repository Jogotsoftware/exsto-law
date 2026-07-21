// Forgot/reset-password: the SECOND leg of the recovery flow (PT-3, founder
// walk item 15.22). The FIRST leg (/portal/forgot-password) calls Supabase's
// own resetPasswordForEmail directly from the browser — no server hop needed
// there, it only sends an email. This route is the write: the browser has
// already exchanged the emailed recovery code for a Supabase session
// (/portal/reset-password, exchangeCodeForSession — the same PKCE pattern the
// email-confirmation return on /portal/login uses) and POSTs that session's
// access token + the chosen new password here.
//
// We VERIFY the access token against Supabase (auth.getUser is authoritative —
// it validates the JWT server-side and returns who it belongs to), then use the
// service-role admin client to set that EXACT uid's password. The uid comes
// from Supabase's own verification, never from the request body, so this can't
// be used to reset a different account's password. Min-length is enforced here
// authoritatively (shared with every other password-setting surface via
// lib/passwordPolicy) — the client-side check is only a fast inline nudge.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { validatePassword } from '@/lib/passwordPolicy'
import { setPasswordByUserId, supabaseAdminConfigured } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(`client-auth-reset-password:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }
  if (!SUPABASE_URL || !SUPABASE_ANON || !supabaseAdminConfigured()) {
    return NextResponse.json(
      { error: 'Password reset is temporarily unavailable. Please contact the firm.' },
      { status: 503 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    accessToken?: unknown
    password?: unknown
  } | null
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Your reset link has expired. Please request a new one.' },
      { status: 400 },
    )
  }

  const pwErr = validatePassword(password)
  if (pwErr) {
    return NextResponse.json({ error: pwErr }, { status: 400 })
  }

  // Authoritative verification: ask Supabase who this (recovery) session
  // belongs to. A tampered, expired, or already-consumed token fails here.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(accessToken)
  const user = data?.user
  if (error || !user?.id) {
    return NextResponse.json(
      { error: 'Your reset link is invalid or has expired. Please request a new one.' },
      { status: 401 },
    )
  }

  try {
    await setPasswordByUserId(user.id, password)
  } catch {
    return NextResponse.json(
      { error: 'We could not reset your password. Please try again or contact the firm.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
