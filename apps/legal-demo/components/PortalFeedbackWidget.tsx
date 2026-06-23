'use client'

// Client-portal feedback widget — the portal's chat bubble. For now its purpose is
// FEEDBACK: a signed-in client tells the firm about their portal experience, and it
// lands in the same triage channel as attorney beta feedback (via the authed,
// client-scoped legal.client.feedback_submit tool). It is pure capture — no AI
// model, no access to matter data — so it is safe on a client-facing surface.
//
// Self-gating: it only renders once a portal session is confirmed (GET
// /api/client/auth/me), so it never appears on /portal/login or /portal/set-password.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { callClientPortalMcp, PortalSessionExpiredError } from '@/lib/mcpClientPortal'

type Phase = 'idle' | 'form' | 'sending' | 'sent' | 'error'

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'ui', label: 'Something looks off' },
  { value: 'feature', label: 'An idea / request' },
  { value: 'other', label: 'Something else' },
]

export function PortalFeedbackWidget() {
  const pathname = usePathname()
  const [authed, setAuthed] = useState(false)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('ui')
  const [error, setError] = useState<string | null>(null)

  // Only show once a portal session is confirmed (keeps it off the auth pages).
  useEffect(() => {
    let cancelled = false
    fetch('/api/client/auth/me', { credentials: 'same-origin' })
      .then((r) => {
        if (!cancelled) setAuthed(r.ok)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!authed) return null

  async function send() {
    const body = message.trim()
    if (!body) return
    setPhase('sending')
    setError(null)
    try {
      await callClientPortalMcp({
        toolName: 'legal.client.feedback_submit',
        input: { message: body, category, pageContext: { path: pathname } },
      })
      setMessage('')
      setPhase('sent')
    } catch (e) {
      if (e instanceof PortalSessionExpiredError) return // wrapper bounces to login
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  return (
    <div className="pfb-root">
      {open ? (
        <div className="pfb-panel" role="dialog" aria-label="Share feedback">
          <div className="pfb-head">
            <strong>Share feedback</strong>
            <button className="pfb-x" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>

          {phase === 'sent' ? (
            <div className="pfb-body">
              <p className="pfb-thanks">Thanks — your feedback went straight to the firm. 🙏</p>
              <button
                className="pfb-link"
                onClick={() => {
                  setPhase('form')
                }}
              >
                Send more
              </button>
            </div>
          ) : (
            <div className="pfb-body">
              <p className="pfb-lead">Tell us about your experience with the portal.</p>
              {error && (
                <div className="alert alert-error" role="alert">
                  {error}
                </div>
              )}
              <select
                className="pfb-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Feedback type"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <textarea
                className="pfb-textarea"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What's working, what's confusing, what you'd like…"
                autoFocus
              />
              <button
                className="pfb-send"
                disabled={phase === 'sending' || !message.trim()}
                onClick={send}
              >
                {phase === 'sending' ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          )}
        </div>
      ) : null}

      <button
        className="pfb-fab"
        aria-label={open ? 'Close feedback' : 'Share feedback'}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          if (phase === 'idle') setPhase('form')
        }}
      >
        {open ? '×' : 'Feedback'}
      </button>
    </div>
  )
}
