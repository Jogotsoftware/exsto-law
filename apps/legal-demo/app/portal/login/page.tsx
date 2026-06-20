'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeInternalPath } from '@/lib/safeRedirect'
import { getSupabaseBrowser, supabaseAuthConfigured } from '@/lib/supabaseBrowser'

// The client-portal sign-in page. Four entry points, all ending at the SAME
// httpOnly portal session:
//   1. Email + password (Supabase Auth) → POST the verified token to
//      /api/client/auth/supabase, which mints our session cookie.
//   2. Google (Supabase OAuth) → returns here with ?code=, we exchange it and
//      bridge the same way.
//   3. Magic link (?token=) → /api/client/auth/consume (the original flow).
//   4. "Email me a link" → /api/client/auth/request (neutral, anti-enumeration).
// When Supabase isn't configured, 1–2 hide and the page is magic-link only.

type Phase = 'form' | 'sent' | 'working' | 'error' | 'check-email'
type Mode = 'password' | 'magic'

export default function ClientPortalLoginPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('form')
  const [mode, setMode] = useState<Mode>(supabaseAuthConfigured ? 'password' : 'magic')
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [continueParam, setContinueParam] = useState('/portal')

  // Exchange a verified Supabase access token for our portal session cookie,
  // then sign the Supabase session out (we only needed the email proof).
  async function bridge(accessToken: string, cont: string) {
    const sb = getSupabaseBrowser()
    const res = await fetch('/api/client/auth/supabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ accessToken, continue: cont }),
    })
    const data = (await res.json().catch(() => null)) as { error?: string; path?: string } | null
    await sb?.auth.signOut().catch(() => {})
    if (!res.ok) throw new Error(data?.error ?? 'We could not sign you in.')
    router.replace(safeInternalPath(data?.path, '/portal'))
  }

  // On mount: resolve which return flow we're in (magic-link consume, OAuth
  // return, or a fresh visit) exactly once.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const cont = safeInternalPath(params.get('continue'), '/portal')
    setContinueParam(cont)

    // (3) Magic-link landing.
    const token = params.get('token')
    if (token) {
      setPhase('working')
      fetch('/api/client/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token, continue: cont }),
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as { error?: string; path?: string } | null
          if (!res.ok) throw new Error(body?.error ?? 'This sign-in link is invalid or has expired.')
          router.replace(safeInternalPath(body?.path, '/portal'))
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e))
          setPhase('error')
        })
      return
    }

    // (2) OAuth / email-confirmation return (Supabase PKCE ?code=).
    const code = params.get('code')
    const sb = getSupabaseBrowser()
    if (code && sb) {
      setPhase('working')
      sb.auth
        .exchangeCodeForSession(code)
        .then(({ data, error: exErr }) => {
          if (exErr || !data.session) throw new Error(exErr?.message ?? 'Sign-in failed.')
          return bridge(data.session.access_token, cont)
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e))
          setPhase('error')
        })
      return
    }

    // (fresh visit) Pre-fill the email from the booking "Create your account" link.
    const prefill = params.get('email')
    if (prefill) setEmail(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Email + password (Supabase Auth).
  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    const sb = getSupabaseBrowser()
    if (!sb) return
    setSubmitting(true)
    setError(null)
    try {
      if (isSignUp) {
        const { data, error: upErr } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/portal/login` },
        })
        if (upErr) throw upErr
        if (data.session) {
          await bridge(data.session.access_token, continueParam) // confirmations off → straight in
        } else {
          setPhase('check-email') // confirmation required
        }
      } else {
        const { data, error: inErr } = await sb.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (inErr) throw inErr
        if (!data.session) throw new Error('We could not sign you in.')
        await bridge(data.session.access_token, continueParam)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  // Google (Supabase OAuth) — redirects to Google, returns to this page w/ ?code.
  async function signInWithGoogle() {
    const sb = getSupabaseBrowser()
    if (!sb) return
    setError(null)
    const redirectTo = `${window.location.origin}/portal/login${
      continueParam !== '/portal' ? `?continue=${encodeURIComponent(continueParam)}` : ''
    }`
    const { error: oErr } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (oErr) setError(oErr.message)
  }

  // Magic link — neutral by design (never reveals whether the email is on file).
  async function requestLink(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await fetch('/api/client/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      setPhase('sent')
    } catch {
      setPhase('sent') // even a network error: stay neutral
    } finally {
      setSubmitting(false)
    }
  }

  // ---- Terminal / transitional states ----
  if (phase === 'working') {
    return (
      <Shell>
        <div className="loading-block" style={{ marginTop: '2rem' }}>
          <span className="spinner" /> Signing you in…
        </div>
      </Shell>
    )
  }
  if (phase === 'error') {
    return (
      <Shell>
        <div className="alert alert-error" style={{ marginTop: 'var(--space-3)' }}>
          {error}
        </div>
        <p style={{ marginTop: 'var(--space-3)' }}>
          <a href="/portal/login">Back to sign in</a>
        </p>
      </Shell>
    )
  }
  if (phase === 'sent') {
    return (
      <Shell title="Check your email">
        <p className="cauth-lead">
          If that email is on file, we&apos;ve sent a secure sign-in link. It expires in 30 minutes.
        </p>
        <p style={{ marginTop: 'var(--space-3)' }}>
          <button className="cauth-link" onClick={() => setPhase('form')}>
            ← Back to sign in
          </button>
        </p>
      </Shell>
    )
  }
  if (phase === 'check-email') {
    return (
      <Shell title="Confirm your email">
        <p className="cauth-lead">
          We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account,
          then come back and sign in.
        </p>
        <p style={{ marginTop: 'var(--space-3)' }}>
          <button className="cauth-link" onClick={() => { setPhase('form'); setIsSignUp(false) }}>
            ← Back to sign in
          </button>
        </p>
      </Shell>
    )
  }

  // ---- Main form ----
  return (
    <Shell>
      <p className="cauth-lead">
        Sign in to view your matters, documents, and messages with the firm.
      </p>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      {mode === 'password' && supabaseAuthConfigured ? (
        <>
          <button className="cauth-google" onClick={signInWithGoogle} type="button">
            <GoogleGlyph /> Continue with Google
          </button>

          <div className="cauth-divider"><span>or</span></div>

          <form onSubmit={submitPassword} className="cauth-form">
            <label className="cauth-label" htmlFor="cauth-email">Email</label>
            <input
              id="cauth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="cauth-input"
            />
            <label className="cauth-label" htmlFor="cauth-pass">Password</label>
            <input
              id="cauth-pass"
              type="password"
              required
              minLength={8}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
              className="cauth-input"
            />
            <button type="submit" className="cauth-primary" disabled={submitting}>
              {submitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="cauth-foot">
            {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
            <button className="cauth-link" onClick={() => { setIsSignUp(!isSignUp); setError(null) }}>
              {isSignUp ? 'Sign in' : 'Create an account'}
            </button>
          </p>
          <p className="cauth-foot">
            <button className="cauth-link" onClick={() => { setMode('magic'); setError(null) }}>
              Email me a sign-in link instead
            </button>
          </p>
        </>
      ) : (
        // Magic-link mode (also the only mode when Supabase isn't configured).
        <>
          <form onSubmit={requestLink} className="cauth-form">
            <label className="cauth-label" htmlFor="cauth-email-magic">Email</label>
            <input
              id="cauth-email-magic"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="cauth-input"
            />
            <button type="submit" className="cauth-primary" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send me a sign-in link'}
            </button>
          </form>
          <p className="cauth-lead" style={{ fontSize: '0.85rem', marginTop: 'var(--space-3)' }}>
            We&apos;ll email you a secure link — no password needed.
          </p>
          {supabaseAuthConfigured && (
            <p className="cauth-foot">
              <button className="cauth-link" onClick={() => { setMode('password'); setError(null) }}>
                ← Sign in with a password or Google
              </button>
            </p>
          )}
        </>
      )}
    </Shell>
  )
}

function Shell({ title = 'Client Portal', children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="public-draft cauth-shell">
      <div className="cauth-card">
        <div className="public-draft-firm">Pacheco Law</div>
        <h1 className="cauth-title">{title}</h1>
        {children}
      </div>
    </main>
  )
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}
