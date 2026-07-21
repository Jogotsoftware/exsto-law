// Service-role Supabase ADMIN client — quarantined to Supabase AUTH provisioning.
//
// Hard rule 9: the SUPABASE_SERVICE_ROLE_KEY is privileged and must never touch
// the substrate Postgres tables (those go through DATABASE_URL + RLS + the action
// layer). This module uses it for EXACTLY ONE thing: GoTrue Auth admin calls
// (auth.admin.*), to set a client's portal password after they've proven control
// of their email via a signed invite token. It performs no PostgREST table
// access, so it cannot read or write substrate data.
//
// Two modules are allowed to read the service-role key — lib/documentStorage.ts
// (Storage) and this one (Auth) — and the invariant guard test enforces that each
// uses the privileged client only for its own narrow surface.
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function supabaseAdminConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY)
}

function getSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Portal account setup is not configured (missing Supabase service role).')
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function looksAlreadyRegistered(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('already been registered') ||
    m.includes('already registered') ||
    m.includes('already exists') ||
    m.includes('email_exists') ||
    m.includes('user already')
  )
}

// Find an existing Auth user id by email. GoTrue's admin API has no server-side
// email filter, so we page through (bounded) and match locally. Fine for a firm's
// client base; if it ever grows past the cap the create path still works and only
// the re-invite/reset path on a very large directory would miss.
async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase()
  const perPage = 200
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === target)
    if (hit) return hit.id
    if (users.length < perPage) break // last page
  }
  return null
}

// Create-or-reset a CONFIRMED-email password account for `email`. Idempotent:
// the first invite creates the account; a re-invite resets the password. We mark
// the email confirmed because the caller has already proven email control via the
// signed invite token (the link was delivered only to the on-file address), so no
// second Supabase confirmation email is needed.
export async function upsertConfirmedPasswordAccount(
  email: string,
  password: string,
): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (!error) return

  if (looksAlreadyRegistered(error.message)) {
    const id = await findUserIdByEmail(admin, email)
    if (!id) throw error
    const { error: updErr } = await admin.auth.admin.updateUserById(id, {
      password,
      email_confirm: true,
    })
    if (updErr) throw updErr
    return
  }
  throw error
}

// N1 — mint an unconfirmed signup account + confirmation token WITHOUT
// Supabase sending its own email. generateLink({type:'signup'}) both creates
// the user (or, for an existing pending signup, regenerates its token) and
// returns hashed_token in one call, and — unlike auth.signUp() — never
// triggers GoTrue's own "Confirm signup" email. The caller sends its own
// branded email using the returned tokenHash
// (?token_hash=...&type=signup, verified client-side via verifyOtp).
//
// An email already registered and CONFIRMED throws "already registered" —
// caught and reported as 'exists' so the caller can fall back to "sign in
// with your existing password" instead of minting a link for it.
export interface SignupConfirmation {
  status: 'created' | 'exists'
  tokenHash?: string
}

export async function mintSignupConfirmation(
  email: string,
  password: string,
): Promise<SignupConfirmation> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup',
    email,
    password,
  })
  if (error) {
    if (looksAlreadyRegistered(error.message)) return { status: 'exists' }
    throw error
  }
  return { status: 'created', tokenHash: data.properties.hashed_token }
}

// N1 — resend: mint a fresh token for an EXISTING, UNCONFIRMED account only.
// Never creates an account (a resend click for an email with no account, or
// one already confirmed, is a silent no-op — same anti-enumeration posture as
// the rest of the auth surface: the caller always shows the same "if that
// address needs confirming…" message either way). The throwaway password
// passed to generateLink is never applied — GoTrue only sets the password at
// creation time; a signup-type link for an existing user is a pure resend
// (the same assumption the intake finalize path relies on: "the password is
// NOT touched" for an existing account).
export async function mintResendConfirmation(email: string): Promise<string | null> {
  const admin = getSupabaseAdmin()
  const id = await findUserIdByEmail(admin, email)
  if (!id) return null
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(id)
  if (userErr) throw userErr
  if (userData.user?.email_confirmed_at) return null // already confirmed — nothing to resend

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup',
    email,
    password: randomUUID(),
  })
  if (error) {
    if (looksAlreadyRegistered(error.message)) return null
    throw error
  }
  return data.properties.hashed_token
}

// N1 — is this email's account already confirmed? Drives the /book account
// step's three-way state (create / sign-in / check-your-email) and the
// resend-confirmation route (refuses to resend for an already-confirmed
// account — that account signs in, it doesn't need another link).
export async function isEmailConfirmed(email: string): Promise<boolean | null> {
  const admin = getSupabaseAdmin()
  const id = await findUserIdByEmail(admin, email)
  if (!id) return null
  const { data, error } = await admin.auth.admin.getUserById(id)
  if (error) throw error
  return Boolean(data.user?.email_confirmed_at)
}

// PT-3 — the forgot/reset-password flow's write. The caller has ALREADY proven
// control of the account by successfully exchanging a Supabase recovery code
// for a session (verified server-side via auth.getUser(accessToken) before
// this is called — see api/client/auth/reset-password/route.ts), so no
// re-verification happens here; this just performs the privileged write for
// the uid that proof was already checked against.
export async function setPasswordByUserId(userId: string, password: string): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) throw error
}

// A2.3 — the Auth-side half of removing a client's portal access. Best-effort:
// no matching Auth user (never signed up, or already removed) is NOT an error
// — the caller's substrate-side revoke (actor deactivated + contact archived)
// is what actually blocks sign-in; this just cleans up the GoTrue account so
// re-inviting the same email later doesn't collide with a stale password.
export async function deleteAuthUserByEmail(email: string): Promise<{ deleted: boolean }> {
  const admin = getSupabaseAdmin()
  const id = await findUserIdByEmail(admin, email)
  if (!id) return { deleted: false }
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) throw error
  return { deleted: true }
}
