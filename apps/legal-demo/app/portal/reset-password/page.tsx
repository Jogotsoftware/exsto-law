'use client'

import { useEffect, useState } from 'react'
import { ScaleIcon, CheckIcon } from '@/components/icons'
import { getSupabaseBrowser, supabaseAuthConfigured } from '@/lib/supabaseBrowser'
import { PasswordField } from '@/components/PasswordField'
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
  passwordsMatch,
  passwordStrength,
  PASSWORD_STRENGTH_LABEL,
} from '@/lib/passwordPolicy'
import { callClientMcp } from '@/lib/mcpClient'
import { PRODUCT_TAGLINE } from '@/lib/brand'

// The reset-password landing (PT-3, founder walk item 15.22) — where the link
// from /portal/forgot-password's email lands. Same PKCE code-exchange pattern
// as the email-confirmation return on /portal/login (exchangeCodeForSession),
// except a recovery code proves "this person controls the email" for a
// PASSWORD CHANGE rather than a sign-in: we hold the resulting access token
// just long enough to POST it to /api/client/auth/reset-password (which
// re-verifies it server-side before writing), then drop the Supabase session
// immediately — it is never used to bridge into a portal session directly.
// After a successful reset the client signs in normally at /portal/login.

type Phase = 'working' | 'form' | 'error' | 'success'

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('working')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [firmName, setFirmName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    callClientMcp<{ firmName: string | null }>({ toolName: 'legal.public.firm_branding' })
      .then((r) => {
        if (!cancelled) setFirmName(r.firmName)
      })
      .catch(() => {
        /* leave the fallback tagline showing */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const sb = getSupabaseBrowser()
    if (!code || !sb) {
      setPhase('error')
      return
    }
    sb.auth
      .exchangeCodeForSession(code)
      .then(({ data, error: exErr }) => {
        if (exErr || !data.session) throw new Error(exErr?.message ?? 'This link no longer works.')
        setAccessToken(data.session.access_token)
        setPhase('form')
        // Drop the Supabase-side session right away — it's held here only long
        // enough to prove the recovery to our own server route below. Our
        // httpOnly portal session (unaffected by this flow) stays the single
        // source of truth for authorization, same as the sign-in bridge.
        return sb.auth.signOut().catch(() => {})
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
    // Mount-only: parse the URL once.
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!accessToken) return
    const pwErr = validatePassword(password)
    if (pwErr) {
      setError(pwErr)
      return
    }
    const matchErr = passwordsMatch(password, confirm)
    if (matchErr) {
      setError(matchErr)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/client/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ accessToken, password }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'We could not reset your password.')
      setPhase('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="li-cp-auth">
      <div className="li-cp-auth-card">
        <div className="li-cp-auth-brand">
          <span className="li-cp-auth-crest" aria-hidden>
            <ScaleIcon size={18} />
          </span>
          <div className="li-cp-auth-firm">{firmName ?? PRODUCT_TAGLINE}</div>
        </div>

        {phase === 'working' && (
          <>
            <h1 className="li-cp-auth-title">Reset your password</h1>
            <div className="loading-block" role="status" style={{ marginTop: 'var(--space-3)' }}>
              <span className="spinner" /> Verifying your link…
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <h1 className="li-cp-auth-title">That link didn&rsquo;t work</h1>
            <p className="li-cp-auth-lead">
              This reset link is invalid or has expired.{error ? ` (${error})` : ''}
            </p>
            <p style={{ marginTop: 'var(--space-3)' }}>
              <a href="/portal/forgot-password">Request a new reset link</a>
            </p>
            <p className="li-cp-auth-foot">
              <a href="/portal/login">Back to sign in</a>
            </p>
          </>
        )}

        {phase === 'success' && (
          <>
            <div className="bk-success" style={{ margin: '0.5rem auto 0.75rem' }}>
              <span className="bk-success-ring" aria-hidden />
              <span className="bk-success-check">
                <CheckIcon size={36} />
              </span>
            </div>
            <h1 className="li-cp-auth-title" style={{ textAlign: 'center' }}>
              Password updated
            </h1>
            <p className="li-cp-auth-lead" style={{ textAlign: 'center' }}>
              Your password has been reset. Sign in with your new password.
            </p>
            <p style={{ marginTop: 'var(--space-3)', textAlign: 'center' }}>
              <a href="/portal/login" className="li-cp-btn li-cp-btn--block li-cp-auth-submit">
                Sign in
              </a>
            </p>
          </>
        )}

        {phase === 'form' && (
          <>
            <h1 className="li-cp-auth-title">Choose a new password</h1>
            {!supabaseAuthConfigured ? (
              <p className="li-cp-auth-lead">
                Sign-in isn&apos;t configured for this environment yet. Please contact the firm.
              </p>
            ) : (
              <>
                {error && (
                  <div
                    className="alert alert-error"
                    role="alert"
                    style={{ marginTop: 'var(--space-3)' }}
                  >
                    {error}
                  </div>
                )}
                <form onSubmit={submit} className="li-cp-auth-form">
                  <PasswordField
                    id="reset-pass"
                    label="New password"
                    value={password}
                    onChange={setPassword}
                    wrapClassName="li-pw-wrap"
                    inputClassName="li-cp-input"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                  />
                  {password.length > 0 && (
                    <p className="li-pw-hint" data-strength={passwordStrength(password)}>
                      Strength: {PASSWORD_STRENGTH_LABEL[passwordStrength(password)]}
                    </p>
                  )}
                  <PasswordField
                    id="reset-confirm"
                    label="Confirm password"
                    value={confirm}
                    onChange={setConfirm}
                    wrapClassName="li-pw-wrap"
                    inputClassName="li-cp-input"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                  />
                  <button
                    type="submit"
                    className="li-cp-btn li-cp-btn--block li-cp-auth-submit"
                    disabled={submitting}
                  >
                    {submitting ? 'Please wait…' : 'Reset password'}
                  </button>
                </form>
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
