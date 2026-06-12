'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeInternalPath } from '@/lib/safeRedirect'

// The client-portal sign-in page. Two jobs:
//   1. No ?token= → show the email form. POSTing to /api/client/auth/request
//      always returns the same neutral message (anti-enumeration), so the UI
//      shows the same confirmation whether or not the email is on file.
//   2. ?token=... → the magic-link landing. POST it to /api/client/auth/consume,
//      which sets the httpOnly session cookie and returns a validated redirect.
export default function ClientPortalLoginPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<'form' | 'sent' | 'consuming' | 'error'>('form')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Token-consume bounce: if we landed with ?token=, exchange it for a session.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) return
    setPhase('consuming')
    const cont = safeInternalPath(params.get('continue'), '/portal')
    fetch('/api/client/auth/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token, continue: cont }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? 'This sign-in link is invalid or has expired.')
        }
        const body = (await res.json()) as { path?: string }
        router.replace(safeInternalPath(body.path, '/portal'))
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
  }, [router])

  async function requestLink(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await fetch('/api/client/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      // Neutral by design: we don't reveal whether the email matched.
      setPhase('sent')
    } catch {
      // Even a network error: show the neutral sent state rather than leak.
      setPhase('sent')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'consuming') {
    return (
      <main className="public-draft">
        <div className="loading-block" style={{ marginTop: '4rem' }}>
          <span className="spinner" /> Signing you in…
        </div>
      </main>
    )
  }

  if (phase === 'error') {
    return (
      <main className="public-draft">
        <div className="public-draft-firm">Pacheco Law</div>
        <h1 style={{ marginTop: 'var(--space-1)' }}>Client Portal</h1>
        <div className="alert alert-error" style={{ marginTop: 'var(--space-3)' }}>
          {error}
        </div>
        <p style={{ marginTop: 'var(--space-3)' }}>
          <a href="/portal/login">Request a new sign-in link</a>
        </p>
      </main>
    )
  }

  if (phase === 'sent') {
    return (
      <main className="public-draft">
        <div className="public-draft-firm">Pacheco Law</div>
        <h1 style={{ marginTop: 'var(--space-1)' }}>Check your email</h1>
        <p style={{ marginTop: 'var(--space-3)' }}>
          If that email is on file, we&apos;ve sent a secure sign-in link. It expires in 30 minutes.
        </p>
      </main>
    )
  }

  return (
    <main className="public-draft">
      <div className="public-draft-firm">Pacheco Law</div>
      <h1 style={{ marginTop: 'var(--space-1)' }}>Client Portal</h1>
      <p className="text-muted" style={{ marginTop: 'var(--space-2)' }}>
        Enter the email you gave the firm and we&apos;ll send you a secure sign-in link.
      </p>
      <form onSubmit={requestLink} style={{ marginTop: 'var(--space-3)', maxWidth: '24rem' }}>
        <label htmlFor="portal-email" className="text-sm">
          Email
        </label>
        <input
          id="portal-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          style={{ display: 'block', width: '100%', marginTop: 'var(--space-1)' }}
        />
        <button type="submit" disabled={submitting} style={{ marginTop: 'var(--space-3)' }}>
          {submitting ? 'Sending…' : 'Send sign-in link'}
        </button>
      </form>
    </main>
  )
}
