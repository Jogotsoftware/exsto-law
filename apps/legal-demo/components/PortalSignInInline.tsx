'use client'

import { useId, useState } from 'react'
import { LockIcon, MailIcon } from '@/components/icons'
import { useI18n } from '@/lib/i18n'
import { getSupabaseBrowser, supabaseAuthConfigured } from '@/lib/supabaseBrowser'
import { PasswordField } from '@/components/PasswordField'

// The password sign-in + session-bridge leg, extracted from /portal/login so the
// booking flow can sign a returning client in WITHOUT navigating (the wizard's
// answers live in component state and die on navigation). Supabase Auth proves
// control of the email; the bridge exchanges its access token for the firm's own
// httpOnly portal session and signs the Supabase session back out. The ?code=
// email-confirmation return stays on /portal/login — this is ONLY the password leg.

export async function bridgeSupabaseSession(
  accessToken: string,
  continuePath: string,
  // N1 — true only for the two confirmation-return callers on /portal/login
  // (verifyOtp / exchangeCodeForSession, right after the user proved control
  // of their email). Tells the bridge route to record the provenanced
  // portal.email_confirmed event; a plain password sign-in leaves it false.
  confirmed = false,
): Promise<{ path: string }> {
  const sb = getSupabaseBrowser()
  const res = await fetch('/api/client/auth/supabase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ accessToken, continue: continuePath, confirmed }),
  })
  const data = (await res.json().catch(() => null)) as { error?: string; path?: string } | null
  await sb?.auth.signOut().catch(() => {})
  if (!res.ok) throw new Error(data?.error ?? 'We could not sign you in.')
  return { path: typeof data?.path === 'string' ? data.path : '/portal' }
}

export async function signInWithPasswordAndBridge(input: {
  email: string
  password: string
  continuePath: string
}): Promise<{ path: string }> {
  const sb = getSupabaseBrowser()
  if (!sb) throw new Error('Sign-in is not configured for this environment.')
  const { data, error } = await sb.auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  })
  if (error) throw error
  if (!data.session) throw new Error('We could not sign you in.')
  return bridgeSupabaseSession(data.session.access_token, input.continuePath)
}

// The inline panel the /book flow renders in place. On success the session
// cookie is already set — the caller re-fetches /api/client/auth/me and carries
// on; the panel never navigates. Errors (wrong password, unconfirmed email,
// unknown client) surface here in the server's own plain copy.
export function PortalSignInInline({
  initialEmail = '',
  continuePath = '/portal',
  onSignedIn,
}: {
  initialEmail?: string
  continuePath?: string
  onSignedIn: () => void | Promise<void>
}) {
  const { t } = useI18n()
  const emailId = useId()
  const passwordId = useId()
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!supabaseAuthConfigured) {
    return (
      <p className="bk-help" role="note">
        {t(
          'signin.unavailable',
          undefined,
          'Sign-in is not available right now — you can continue without it.',
        )}
      </p>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (working) return
    setWorking(true)
    setError(null)
    try {
      await signInWithPasswordAndBridge({ email, password, continuePath })
      await onSignedIn()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('signin.failed', undefined, 'We could not sign you in.'),
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <form className="bk-signin-inline" onSubmit={submit}>
      {error && (
        <div className="bk-alert" role="alert">
          {error}
        </div>
      )}
      <div className="bk-fields">
        <div className="bk-field">
          <label className="bk-label" htmlFor={emailId}>
            {t('signin.email', undefined, 'Email')}
          </label>
          <div className="bk-input-wrap">
            <span className="bk-input-icon" aria-hidden>
              <MailIcon size={18} />
            </span>
            <input
              id={emailId}
              className="bk-input"
              type="email"
              inputMode="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="bk-field">
          <label className="bk-label" htmlFor={passwordId}>
            {t('signin.password', undefined, 'Password')}
          </label>
          <PasswordField
            id={passwordId}
            value={password}
            onChange={setPassword}
            wrapClassName="bk-input-wrap"
            inputClassName="bk-input"
            leadingIcon={<LockIcon size={18} />}
            required
            autoComplete="current-password"
          />
        </div>
      </div>
      <button
        type="submit"
        className="bk-btn bk-btn-primary bk-btn-wide"
        disabled={working || !email.trim() || !password}
      >
        {working && <span className="bk-spinner bk-spinner-sm" />}
        {working
          ? t('signin.working', undefined, 'Signing you in…')
          : t('signin.submit', undefined, 'Sign in')}
      </button>
    </form>
  )
}
