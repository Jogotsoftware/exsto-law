'use client'

// Browser-only Supabase client, used SOLELY as the client-portal sign-in front
// door (email + password via Supabase Auth). Once Supabase verifies the
// identity, we exchange its access token for our own httpOnly portal session
// (/api/client/auth/supabase) and sign the Supabase session back out — so the
// substrate-side authorization (the exsto_client_session cookie) is the single
// source of truth, unchanged. Supabase Auth only proves "this person controls
// this email".
//
// Returns null when the public env isn't configured, so the login page can show
// a clear "not configured" notice instead of crashing.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabaseAuthConfigured = Boolean(URL && ANON)

let client: SupabaseClient | null = null

export function getSupabaseBrowser(): SupabaseClient | null {
  if (!supabaseAuthConfigured) return null
  if (!client) {
    client = createClient(URL as string, ANON as string, {
      auth: {
        // Persist briefly so the confirmation round-trip can recover the session
        // on return; we sign out right after bridging to our own cookie.
        persistSession: true,
        autoRefreshToken: false,
        // The login page handles the ?code= confirmation return EXPLICITLY
        // (exchangeCodeForSession). Leaving auto-detection on would race that
        // call for the single-use PKCE code and intermittently break the
        // confirm-click sign-in — which is the only path that bridges a freshly
        // created account, so it must be reliable.
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  }
  return client
}
