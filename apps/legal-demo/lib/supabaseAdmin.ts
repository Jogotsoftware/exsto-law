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
