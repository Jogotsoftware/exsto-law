'use client'

import { useEffect, useState } from 'react'
import { ScaleIcon } from '@/components/icons'
import { getSupabaseBrowser, supabaseAuthConfigured } from '@/lib/supabaseBrowser'
import { callClientMcp } from '@/lib/mcpClient'
import { PRODUCT_TAGLINE } from '@/lib/brand'
import { safeInternalPath } from '@/lib/safeRedirect'

// Forgot-password request screen (PT-3, founder walk item 15.22) — the leg
// that was entirely missing before this. Deliberately ALWAYS shows the same
// "check your email" message once submitted, whether or not the address has a
// portal account: Supabase's resetPasswordForEmail already behaves this way
// (it never reveals account existence), and echoing anything different here
// would reopen the same account-enumeration hole it closes.
//
// Tenant-aware redirect: forwards whatever ?firm= slug selected the current
// tenant (MULTI-TENANT-1) into the reset link's redirectTo, so the reset
// screen the client lands on later — possibly on a different device/browser
// with no firm_slug cookie — still resolves and shows the right firm's
// branding. See middleware.ts (this route + /portal/reset-password are in its
// matcher) and app/portal/login/page.tsx's withFirm() for the same pattern.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [firmParam, setFirmParam] = useState<string | null>(null)
  const [continueParam, setContinueParam] = useState('/portal')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [firmName, setFirmName] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const firm = params.get('firm')
    if (firm) setFirmParam(firm)
    setContinueParam(safeInternalPath(params.get('continue'), '/portal'))
  }, [])

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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const sb = getSupabaseBrowser()
    if (!sb) return
    setSubmitting(true)
    const redirectTo = `${window.location.origin}/portal/reset-password${
      firmParam ? `?firm=${encodeURIComponent(firmParam)}` : ''
    }`
    try {
      await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    } catch {
      // Deliberately swallowed — see the module comment. A real outage still
      // shows the same message; the client can always retry or contact the firm.
    } finally {
      setSubmitting(false)
      setSent(true)
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
        <h1 className="li-cp-auth-title">Reset your password</h1>

        {sent ? (
          <>
            <p className="li-cp-auth-lead">
              If <strong>{email}</strong> has a portal account, we&rsquo;ve sent a link to reset the
              password. Check your inbox (and spam folder) for a message from the firm.
            </p>
            <p style={{ marginTop: 'var(--space-3)' }}>
              <a
                href={`/portal/login?continue=${encodeURIComponent(continueParam)}${
                  firmParam ? `&firm=${encodeURIComponent(firmParam)}` : ''
                }`}
              >
                Back to sign in
              </a>
            </p>
          </>
        ) : !supabaseAuthConfigured ? (
          <p className="li-cp-auth-lead">
            Sign-in isn&apos;t configured for this environment yet. Please contact the firm.
          </p>
        ) : (
          <>
            <p className="li-cp-auth-lead">
              Enter the email on your portal account and we&rsquo;ll send you a link to reset your
              password.
            </p>
            <form onSubmit={submit} className="li-cp-auth-form">
              <label className="li-cp-label" htmlFor="forgot-email">
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="li-cp-input"
              />
              <button
                type="submit"
                className="li-cp-btn li-cp-btn--block li-cp-auth-submit"
                disabled={submitting || !email.trim()}
              >
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="li-cp-auth-foot">
              <a
                href={`/portal/login?continue=${encodeURIComponent(continueParam)}${
                  firmParam ? `&firm=${encodeURIComponent(firmParam)}` : ''
                }`}
              >
                Back to sign in
              </a>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
