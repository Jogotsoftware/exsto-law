// Defense-in-depth for the client-portal Supabase bridge.
//
// The bridge (/api/client/auth/supabase) trusts Supabase's `email_confirmed_at`
// as proof that the signer controls the email it claims. That proof only holds
// when the project REQUIRES email confirmation. If Supabase's "Confirm email"
// setting is OFF, GoTrue auto-confirms every sign-up (it sets email_confirmed_at
// with no inbox round-trip) — so an attacker could "Create an account" AS another
// client's email, then sign in with the password they chose and bridge into that
// client's portal. The dashboard toggle lives outside the repo and CI, so we do
// NOT rely on documentation: before minting a session we confirm, against
// GoTrue's own public /auth/v1/settings, that auto-confirm is OFF. If it is ON —
// or we cannot determine it — we FAIL CLOSED, turning a silent cross-account
// takeover into a loud, self-announcing sign-in outage.

export type ConfirmGate = 'ok' | 'autoconfirm-on' | 'unknown'

// Pure decision over GoTrue's /auth/v1/settings body. We only treat an explicit
// `mailer_autoconfirm === false` as safe; a missing/oddly-typed field is treated
// as unknown (fail closed) rather than assumed safe.
export function confirmGateFromSettings(settings: unknown): ConfirmGate {
  if (!settings || typeof settings !== 'object') return 'unknown'
  const v = (settings as { mailer_autoconfirm?: unknown }).mailer_autoconfirm
  if (v === false) return 'ok'
  if (v === true) return 'autoconfirm-on'
  return 'unknown'
}

// Only the affirmative-safe ('ok') reading is cached, and only briefly, so we
// don't fetch settings on every sign-in. An 'autoconfirm-on' or 'unknown' result
// is never cached — a project flipped into auto-confirm is caught on the very
// next request. The short TTL also bounds the window in which a freshly-flipped
// project could still serve a stale 'ok'.
const TTL_MS = 60_000
let cache: { gate: 'ok'; at: number } | null = null

export function __resetConfirmGuardCacheForTest(): void {
  cache = null
}

// Returns the gate. 'ok' = confirmation is required (safe to trust
// email_confirmed_at). Anything else means the caller MUST fail closed.
export async function emailConfirmationGate(opts: {
  settingsUrl: string
  anonKey: string
  fetchImpl?: typeof fetch
  now?: number
}): Promise<ConfirmGate> {
  const now = opts.now ?? Date.now()
  if (cache && now - cache.at < TTL_MS) return 'ok'

  const f = opts.fetchImpl ?? fetch
  try {
    const res = await f(`${opts.settingsUrl.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: opts.anonKey },
      cache: 'no-store',
    })
    if (res.ok) {
      const gate = confirmGateFromSettings(await res.json())
      if (gate === 'ok') cache = { gate, at: now }
      return gate
    }
  } catch {
    // Network/parse failure: fall through to a recent safe reading if we have
    // one, so a transient blip doesn't lock every client out — but never invent
    // a safe answer we haven't actually observed.
  }
  if (cache && now - cache.at < TTL_MS) return 'ok'
  return 'unknown'
}
