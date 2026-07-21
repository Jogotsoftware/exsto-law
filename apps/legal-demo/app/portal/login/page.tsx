'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { safeInternalPath } from '@/lib/safeRedirect'
import { CheckIcon, ScaleIcon } from '@/components/icons'
import type { EmailOtpType } from '@supabase/supabase-js'
import { getSupabaseBrowser, supabaseAuthConfigured } from '@/lib/supabaseBrowser'
import { bridgeSupabaseSession, signInWithPasswordAndBridge } from '@/components/PortalSignInInline'
import { callClientMcp } from '@/lib/mcpClient'
import { PRODUCT_TAGLINE } from '@/lib/brand'
import { PasswordField } from '@/components/PasswordField'
import { validatePassword, passwordStrength, PASSWORD_STRENGTH_LABEL } from '@/lib/passwordPolicy'

// The client-portal sign-in page — email + password (Supabase Auth). On sign in
// or a confirmed sign-up we POST the verified token to /api/client/auth/supabase,
// which maps the verified email to the firm's client_contact and mints our own
// httpOnly portal session (the substrate-side authorization is unchanged). The
// password + bridge leg is shared with the /book inline panel
// (components/PortalSignInInline.tsx); the ?code= confirmation return below is
// this page's alone.

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
  const [firmParam, setFirmParam] = useState<string | null>(null)
  const [langParam, setLangParam] = useState<'en' | 'es'>('en')
  // A2.2/PT-3 follow-on — the confirmation ?code= exchange can fail because the
  // link expired or was already used. Rather than a dead end, offer to resend
  // (same anti-enumeration posture as forgot-password: always the same message).
  const [resendEmail, setResendEmail] = useState('')
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle')

  // N1 — shared resend call (error phase AND check-email phase use this): a
  // server route that mints a fresh token + sends our own branded email,
  // never Supabase's default one. Anti-enumeration: always resolves the same
  // way regardless of what the address actually is.
  async function resendConfirmation(toEmail: string) {
    setResendStatus('sending')
    try {
      await fetch('/api/client/auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: toEmail.trim(), lang: langParam }),
      })
    } catch {
      // Swallow — the confirmation message is deliberately the same either way.
    } finally {
      setResendStatus('sent')
    }
  }

  // Forward whatever selected the current tenant (the funnel's ?firm= slug,
  // MULTI-TENANT-1) into a link the client is about to follow, so the forgot/
  // reset round-trip keeps showing the same firm's branding instead of falling
  // back to the generic product tagline.
  function withFirm(path: string): string {
    return firmParam
      ? `${path}${path.includes('?') ? '&' : '?'}firm=${encodeURIComponent(firmParam)}`
      : path
  }

  // Exchange a verified Supabase access token for our portal session cookie
  // (shared bridge), then navigate — this page's job, not the shared leg's.
  // `confirmed` is only true for the two confirmation-return paths below (the
  // moment this browser proved control of the email); it tells the bridge
  // route to record the provenanced portal.email_confirmed event — a plain
  // password sign-in never re-fires it.
  async function bridge(accessToken: string, cont: string, confirmed = false) {
    const { path } = await bridgeSupabaseSession(accessToken, cont, confirmed)
    router.replace(safeInternalPath(path, '/portal'))
  }

  // On mount: handle an email-confirmation return (?code=) and pre-fill ?email=.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const cont = safeInternalPath(params.get('continue'), '/portal')
    setContinueParam(cont)
    const firm = params.get('firm')
    if (firm) setFirmParam(firm)
    if (params.get('lang') === 'es') setLangParam('es')

    const code = params.get('code')
    const tokenHash = params.get('token_hash')
    const otpType = params.get('type')
    const sb = getSupabaseBrowser()

    // token_hash confirmation: the account that sent this link was created
    // server-side (intake finalize), so no PKCE code_verifier exists on any
    // browser — exchangeCodeForSession would always fail for it. verifyOtp
    // needs only the token_hash from the link itself, so it works regardless
    // of which device/browser confirms. Requires the Supabase "Confirm
    // signup" email template to link here with token_hash + type (see
    // Auth > Email Templates in the Supabase dashboard).
    if (tokenHash && otpType && sb) {
      setPhase('working')
      sb.auth
        .verifyOtp({ token_hash: tokenHash, type: otpType as EmailOtpType })
        .then(({ data, error: vErr }) => {
          if (vErr || !data.session) throw new Error(vErr?.message ?? 'Sign-in failed.')
          return bridge(data.session.access_token, cont, true)
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e))
          setPhase('error')
        })
      return
    }

    // ?code= confirmation return: only reliable when the same browser that
    // called signUp (the in-page "Create an account" form below) is the one
    // confirming, since PKCE's code_verifier lives in that browser's storage.
    if (code && sb) {
      setPhase('working')
      sb.auth
        .exchangeCodeForSession(code)
        .then(({ data, error: exErr }) => {
          if (exErr || !data.session) throw new Error(exErr?.message ?? 'Sign-in failed.')
          return bridge(data.session.access_token, cont, true)
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
        const pwErr = validatePassword(password)
        if (pwErr) throw new Error(pwErr)
        // N1 — server-side: admin.generateLink mints the unconfirmed account +
        // token and we send our own branded email, never Supabase's default
        // one (was: client-side sb.auth.signUp(), which always triggered
        // GoTrue's own "Confirm signup" email). No session is ever minted
        // here — the ?token_hash= confirmation return (handled on mount) is
        // the only path that bridges a newly-created account.
        const res = await fetch('/api/client/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password, lang: langParam }),
        })
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(data?.error ?? 'Could not create your account.')
        setSubmitting(false)
        setPhase('check-email')
      } else {
        const { path } = await signInWithPasswordAndBridge({
          email,
          password,
          continuePath: continueParam,
        })
        router.replace(safeInternalPath(path, '/portal'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  // A2.2 — 'working' is set ONLY by the ?code= confirmation-return effect
  // above, so reaching this render means Supabase already confirmed the
  // email server-side (that's what minted the code); exchangeCodeForSession
  // below is just the session handoff. Branded "you made it" landing instead
  // of a bare spinner — the dead-end this replaces was the redirect target
  // never resolving at all (wrong fallback domain, fixed alongside this).
  if (phase === 'working') {
    return (
      <Shell title="You're Confirmed">
        <div className="bk-success" style={{ margin: '0.5rem auto 0.75rem' }}>
          <span className="bk-success-ring" aria-hidden />
          <span className="bk-success-check">
            <CheckIcon size={36} />
          </span>
        </div>
        <div className="loading-block" role="status">
          <span className="spinner" /> Signing you in…
        </div>
      </Shell>
    )
  }
  if (phase === 'error') {
    // A confirmation link only reaches this branch after a failed code
    // exchange — expired, already used, or tampered. Never a bare dead end:
    // offer to resend (same always-say-the-same-thing posture as
    // forgot-password, so this can't be used to probe which emails exist).
    return (
      <Shell title="That link didn’t work">
        <p className="li-cp-auth-lead">
          This confirmation link is invalid or has expired. {error ? `(${error})` : ''}
        </p>
        {resendStatus === 'sent' ? (
          <div className="alert alert-success" style={{ marginTop: 'var(--space-3)' }}>
            If that address needs confirming, we&rsquo;ve sent a fresh link. Check your inbox.
          </div>
        ) : (
          <form
            className="li-cp-auth-form"
            onSubmit={(e) => {
              e.preventDefault()
              void resendConfirmation(resendEmail)
            }}
          >
            <label className="li-cp-label" htmlFor="resend-email">
              Email
            </label>
            <input
              id="resend-email"
              type="email"
              required
              autoComplete="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@example.com"
              className="li-cp-input"
            />
            <button
              type="submit"
              className="li-cp-btn li-cp-btn--block li-cp-auth-submit"
              disabled={resendStatus === 'sending'}
            >
              {resendStatus === 'sending' ? 'Sending…' : 'Resend confirmation email'}
            </button>
          </form>
        )}
        <p style={{ marginTop: 'var(--space-3)' }}>
          <a href="/portal/login">Back to sign in</a>
        </p>
      </Shell>
    )
  }
  if (phase === 'check-email') {
    return (
      <Shell title="Confirm your email">
        <p className="li-cp-auth-lead">
          We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
          account, then come back and sign in.
        </p>
        {resendStatus === 'sent' ? (
          <div className="alert alert-success" style={{ marginTop: 'var(--space-3)' }}>
            We&rsquo;ve sent a fresh link to <strong>{email}</strong>. Check your inbox.
          </div>
        ) : (
          <p style={{ marginTop: 'var(--space-3)' }}>
            <button
              type="button"
              className="li-cp-linkbtn"
              disabled={resendStatus === 'sending'}
              onClick={() => void resendConfirmation(email)}
            >
              {resendStatus === 'sending' ? 'Sending…' : "Didn't get it? Resend the email"}
            </button>
          </p>
        )}
        <p style={{ marginTop: 'var(--space-3)' }}>
          <button
            className="li-cp-linkbtn"
            onClick={() => {
              setPhase('form')
              setIsSignUp(false)
              setResendStatus('idle')
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <ChevronLeft size={14} aria-hidden /> Back to sign in
            </span>
          </button>
        </p>
      </Shell>
    )
  }

  if (!supabaseAuthConfigured) {
    return (
      <Shell>
        <p className="li-cp-auth-lead">
          Sign-in isn&apos;t configured for this environment yet. Please contact the firm.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <p className="li-cp-auth-lead">
        Sign in to view your matters, documents, and messages with the firm.
      </p>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      <form onSubmit={submit} className="li-cp-auth-form">
        <label className="li-cp-label" htmlFor="cauth-email">
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
          className="li-cp-input"
        />
        <PasswordField
          id="cauth-pass"
          label="Password"
          value={password}
          onChange={setPassword}
          wrapClassName="li-pw-wrap"
          inputClassName="li-cp-input"
          required
          // Enforce a minimum only when creating an account; an existing
          // password may be shorter (don't lock a returning client out).
          // The authoritative check is validatePassword() in submit() —
          // this is just the native inline nudge.
          minLength={isSignUp ? 8 : undefined}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
        />
        {isSignUp && password.length > 0 && (
          <p className="li-pw-hint" data-strength={passwordStrength(password)}>
            Strength: {PASSWORD_STRENGTH_LABEL[passwordStrength(password)]}
          </p>
        )}
        {!isSignUp && (
          <p className="li-cp-auth-forgot">
            <a
              href={withFirm(
                `/portal/forgot-password?continue=${encodeURIComponent(continueParam)}`,
              )}
              className="li-cp-linkbtn"
            >
              Forgot password?
            </a>
          </p>
        )}
        <button
          type="submit"
          className="li-cp-btn li-cp-btn--block li-cp-auth-submit"
          disabled={submitting}
        >
          {submitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="li-cp-auth-foot">
        {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
        <button
          className="li-cp-linkbtn"
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
  // FB-C — the resolved firm's name (never a hardcoded literal), via the same
  // public firm-branding tool the booking page uses. Falls back to the product
  // tagline while loading / when no firm slug is in play — never a guess.
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

  return (
    <main className="li-cp-auth">
      {/* A1.1 — the funnel's aurora treatment, so a returning client landing
          here from the chooser (or a bookmarked link) doesn't hit a visually
          disconnected surface. Zero auth-flow changes below this line. */}
      <div className="bk-aurora" aria-hidden />
      <div className="li-cp-auth-card">
        <div className="li-cp-auth-brand">
          <span className="li-cp-auth-crest" aria-hidden>
            <ScaleIcon size={18} />
          </span>
          <div className="li-cp-auth-firm">{firmName ?? PRODUCT_TAGLINE}</div>
        </div>
        <h1 className="li-cp-auth-title">{title}</h1>
        {children}
      </div>
    </main>
  )
}
