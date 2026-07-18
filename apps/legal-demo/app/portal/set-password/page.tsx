'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeInternalPath } from '@/lib/safeRedirect'
import { ScaleIcon } from '@/components/icons'

// Invite landing: the client arrives here from the "set up your portal access"
// email (/portal/set-password?token=…). They choose a password; we POST it with
// the token to /api/client/auth/set-password, which verifies the token, sets a
// confirmed Supabase Auth password, and signs them straight in. On every later
// visit they use email + password at /portal/login.

const MIN_PASSWORD_LENGTH = 8

export default function SetPasswordPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [continueParam, setContinueParam] = useState('/portal')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setToken(params.get('token'))
    setContinueParam(safeInternalPath(params.get('continue'), '/portal'))
    // Mount-only: read the token + continue target from the URL once.
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!token) {
      setError('This invite link is missing its token. Ask the firm to send a new one.')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/client/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token, password, continue: continueParam }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; path?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'We could not set your password.')
      router.replace(safeInternalPath(data?.path, '/portal'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <Shell title="Set your password">
      <p className="li-cp-auth-lead">
        Choose a password for your Pacheco Law client portal. You&apos;ll use your email and this
        password to sign in.
      </p>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      <form onSubmit={submit} className="li-cp-auth-form">
        <label className="li-cp-label" htmlFor="cauth-pass">
          New password
        </label>
        <input
          id="cauth-pass"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="li-cp-input"
        />
        <label className="li-cp-label" htmlFor="cauth-confirm">
          Confirm password
        </label>
        <input
          id="cauth-confirm"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Re-enter your password"
          className="li-cp-input"
        />
        <button
          type="submit"
          className="li-cp-btn li-cp-btn--block li-cp-auth-submit"
          disabled={submitting}
        >
          {submitting ? 'Please wait…' : 'Set password & sign in'}
        </button>
      </form>

      <p className="li-cp-auth-foot">
        Already set this up? <a href="/portal/login">Sign in</a>
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
    <main className="li-cp-auth">
      <div className="li-cp-auth-card">
        <div className="li-cp-auth-brand">
          <span className="li-cp-auth-crest" aria-hidden>
            <ScaleIcon size={18} />
          </span>
          <div className="li-cp-auth-firm">Pacheco Law</div>
        </div>
        <h1 className="li-cp-auth-title">{title}</h1>
        {children}
      </div>
    </main>
  )
}
