'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeInternalPath } from '@/lib/safeRedirect'
import { getSupabaseBrowser, supabaseAuthConfigured } from '@/lib/supabaseBrowser'

// The client-portal sign-in page — email + password (Supabase Auth). On sign in
// or a confirmed sign-up we POST the verified token to /api/client/auth/supabase,
// which maps the verified email to the firm's client_contact and mints our own
// httpOnly portal session (the substrate-side authorization is unchanged).

type Phase = 'form' | 'working' | 'error' | 'check-email'

export default function ClientPortalLoginPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('form')
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

  // On mount: handle an email-confirmation return (?code=) and pre-fill ?email=.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const cont = safeInternalPath(params.get('continue'), '/portal')
    setContinueParam(cont)

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

    const prefill = params.get('email')
    if (prefill) setEmail(prefill)
    // Mount-only: parse the URL once (?code= confirmation return, ?email= prefill).
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const sb = getSupabaseBrowser()
    if (!sb) return
    setSubmitting(true)
    setError(null)
    try {
      if (isSignUp) {
        const { error: upErr } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/portal/login` },
        })
        if (upErr) throw upErr
        // ALWAYS require the email-confirmation click — never bridge a fresh
        // sign-up session. If the Supabase project has "Confirm email" turned off
        // it auto-issues a confirmed session here, which would let anyone sign up
        // AS another client's email and take over their portal. Drop any such
        // session; the ?code= confirmation return (handled on mount) is the only
        // path that bridges a newly-created account.
        await sb.auth.signOut().catch(() => {})
        setSubmitting(false)
        setPhase('check-email')
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
  if (phase === 'check-email') {
    return (
      <Shell title="Confirm your email">
        <p className="cauth-lead">
          We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
          account, then come back and sign in.
        </p>
        <p style={{ marginTop: 'var(--space-3)' }}>
          <button
            className="cauth-link"
            onClick={() => {
              setPhase('form')
              setIsSignUp(false)
            }}
          >
            ← Back to sign in
          </button>
        </p>
      </Shell>
    )
  }

  if (!supabaseAuthConfigured) {
    return (
      <Shell>
        <p className="cauth-lead">
          Sign-in isn&apos;t configured for this environment yet. Please contact the firm.
        </p>
      </Shell>
    )
  }

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

      <form onSubmit={submit} className="cauth-form">
        <label className="cauth-label" htmlFor="cauth-email">
          Email
        </label>
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
        <label className="cauth-label" htmlFor="cauth-pass">
          Password
        </label>
        <input
          id="cauth-pass"
          type="password"
          required
          // Enforce a minimum only when creating an account; an existing
          // password may be shorter (don't lock a returning client out).
          minLength={isSignUp ? 8 : undefined}
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
        <button
          className="cauth-link"
          onClick={() => {
            setIsSignUp(!isSignUp)
            setError(null)
          }}
        >
          {isSignUp ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </Shell>
  )
}

function Shell({
  title = 'Client Portal',
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
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
