'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { safeInternalPath } from '@/lib/safeRedirect'
import { CheckIcon, ScaleIcon } from '@/components/icons'
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
  // A2.2/PT-3 follow-on — the confirmation ?code= exchange can fail because the
  // link expired or was already used. Rather than a dead end, offer to resend
  // (same anti-enumeration posture as forgot-password: always the same message).
  const [resendEmail, setResendEmail] = useState('')
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle')

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
  async function bridge(accessToken: string, cont: string) {
    const { path } = await bridgeSupabaseSession(accessToken, cont)
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
        const pwErr = validatePassword(password)
        if (pwErr) throw new Error(pwErr)
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
            onSubmit={async (e) => {
              e.preventDefault()
              const sb = getSupabaseBrowser()
              setResendStatus('sending')
              try {
                await sb?.auth.resend({
                  type: 'signup',
                  email: resendEmail.trim(),
                  options: { emailRedirectTo: `${window.location.origin}/portal/login` },
                })
              } catch {
                // Swallow — the confirmation message below is deliberately the
                // same whether or not the address is a real account.
              } finally {
                setResendStatus('sent')
              }
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
        <p style={{ marginTop: 'var(--space-3)' }}>
          <button
            className="li-cp-linkbtn"
            onClick={() => {
              setPhase('form')
              setIsSignUp(false)
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
